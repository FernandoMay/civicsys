#!/usr/bin/env bash
set -euo pipefail

# Brújula Cívica — TTL keeper (RFC BRUJULA-CIVICA-ARCH-001 §2, threat T14).
#
# Soroban storage entries expire. The contracts extend the TTL of every record
# on each write and extend the instance generously, so a proposal or a tally
# survives ~58 days of inactivity without a keeper. But two things are NOT
# refreshed by writes alone:
#
#   - the contract **instance** (admin, next_id)
#   - the contract **wasm** itself
#
# If either lapses, the contract does not degrade gracefully — it stops
# answering permanently, and every record it holds becomes unreachable. This
# script refreshes both.
#
# SCOPE, stated honestly:
#   - instance + wasm: refreshed here, for all four contracts.
#   - individual records (credentials, proposals, tallies, roots): NOT refreshed
#     here. The public testnet RPC exposes no `extendFootprintTtl` and
#     `stellar contract extend` only accepts symbol or raw-XDR keys, not the
#     composite `DataKey::{Credential(Address), Proposal(u64), ...}` keys this
#     codebase uses. Those records are protected by extend-on-write plus this
#     documented residual risk. Closing it needs a keeper with direct RPC access
#     or a contract-level refresh entrypoint (Phase 3+ work).

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

RECORD="${1:-deployments/testnet.json}"
LEDGERS="${BRUJULA_CIVICA_TTLLEDGERS:-1000000}"
SOURCE="${BRUJULA_CIVICA_DEPLOYER:-brujula-deployer}"
NETWORK="${BRUJULA_CIVICA_NETWORK:-testnet}"
LEDGER_DIR="$ROOT/deployments/logs"

[ -f "$RECORD" ] || { echo "FATAL: $RECORD not found" >&2; exit 1; }
command -v jq >/dev/null || { echo "FATAL: jq required" >&2; exit 1; }
command -v stellar >/dev/null || { echo "FATAL: stellar CLI required" >&2; exit 1; }

mkdir -p "$LEDGER_DIR"
NETWORK_NAME="$(jq -r '.network' "$RECORD")"

echo "== TTL keeper"
echo "   network=$NETWORK_NAME  ledgers_to_extend=$LEDGERS  source=$SOURCE"

extend() {
  local label="$1"; shift
  local out
  if out="$(stellar contract extend \
      --ledgers-to-extend "$LEDGERS" \
      --source-account "$SOURCE" \
      --network "$NETWORK" \
      --ttl-ledger-only \
      "$@" 2>&1)"; then
    printf '   %-34s ttl=%s\n' "$label" "$(printf '%s' "$out" | grep -Eo '[0-9]+$' | tail -1)"
    return 0
  fi
  printf '   %-34s ERROR\n' "$label"
  printf '%s\n' "$out" | tail -5 >&2
  return 1
}

fail=0
while read -r name cid wasm; do
  [ -n "$name" ] || continue
  # Instance first: without it the contract has no admin and cannot be repaired.
  extend "$name · instance" --id "$cid" || fail=1
  extend "$name · wasm"     --wasm-hash "$wasm" || fail=1
done < <(
  jq -r '.contracts | to_entries[] | "\(.key) \(.value.contract_id) \(.value.wasm_sha256)"' "$RECORD"
)

echo
if [ "$fail" = 1 ]; then
  echo "TTL KEEPER FAILED — one or more extensions did not succeed" >&2
  exit 1
fi

echo "TTL KEEPER OK — instance and wasm refreshed for every contract in $RECORD"
echo "Records (credentials, proposals, tallies, roots) rely on extend-on-write;"
echo "that residual risk is documented in docs/threat-model.md (T14)."