#!/usr/bin/env bash
set -euo pipefail

# Brújula Cívica — verify a deployment evidence record (RFC §9, §10).
#
# Fails (exit 1) unless, for every contract:
#   1. the record exists and has all required fields (no UNKNOWN/null);
#   2. the local wasm's sha256 matches the recorded source hash;
#   3. the recorded version matches Cargo.toml;
#   4. --live: the contract answers `contract info interface` on the network
#      (proof the contract id really holds that code on-chain).

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

RECORD="${1:-deployments/testnet.json}"
CARGO_TARGET_DIR="${CARGO_TARGET_DIR:-$ROOT/target}"
WASM_DIR="$CARGO_TARGET_DIR/wasm32v1-none/release"
LIVE=0
[ "${2:-}" = "--live" ] && LIVE=1

fail=0
err() { echo "FAIL: $*" >&2; fail=1; }

[ -f "$RECORD" ] || { echo "FAIL: $RECORD not found" >&2; exit 1; }
jq -e . "$RECORD" >/dev/null || { echo "FAIL: $RECORD is not valid JSON" >&2; exit 1; }

echo "== record: $RECORD"
jq -r '"network=\(.network) source=\(.source_account) generated=\(.generated_at)"' "$RECORD"

VERSION="$(grep -m1 '^version' contracts/brujula-identity/Cargo.toml | cut -d'"' -f2)"

for key in brujula-identity brujula-proposal brujula-vote brujula-accountability; do
  echo "-- $key"
  c="$(jq -c ".contracts[\"$key\"]" "$RECORD")"
  [ "$c" != "null" ] || { err "$key missing from record"; continue; }

  cid="$(jq -r .contract_id <<<"$c")"
  tx="$(jq -r .deploy_tx <<<"$c")"
  sha="$(jq -r .wasm_sha256 <<<"$c")"
  ver="$(jq -r .version <<<"$c")"
  net="$(jq -r .network "$RECORD")"

  for field_name in contract_id deploy_tx wasm_sha256 version; do
    v="$(jq -r ".$field_name" <<<"$c")"
    case "$v" in ""|null|UNKNOWN) err "$key.$field_name is $v" ;; esac
  done
  [[ "$cid" == C* ]] || err "$key contract_id not a contract address: $cid"
  [[ "$tx" =~ ^[0-9a-f]{64}$ ]] || err "$key deploy_tx not a 64-hex tx hash: $tx"
  [ "$ver" = "$VERSION" ] || err "$key version $ver != Cargo.toml $VERSION"

  wasm="$WASM_DIR/$(echo "$key" | tr - _).wasm"
  if [ -f "$wasm" ]; then
    local_sha="$(shasum -a 256 "$wasm" | awk '{print $1}')"
    [ "$local_sha" = "$sha" ] || err "$key wasm sha mismatch: local $local_sha != recorded $sha"
  else
    err "$key wasm not found at $wasm (run 'stellar contract build' first)"
  fi

  if [ "$LIVE" = 1 ]; then
    if stellar contract info interface --id "$cid" --network "$net" >/dev/null 2>&1; then
      echo "   live on-chain interface: OK"
    else
      err "$key contract $cid does not answer on $net"
    fi
  fi
done

if [ "$fail" = 1 ]; then
  echo; echo "VERIFICATION FAILED — see errors above." >&2
  exit 1
fi
echo
echo "VERIFICATION PASSED$([ "$LIVE" = 1 ] && echo ' (including live on-chain checks)')."
