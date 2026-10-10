#!/usr/bin/env bash
set -euo pipefail

# Brújula Cívica — evidence-first testnet deployment.
# Source of truth: docs/rfc/BRUJULA-CIVICA-ARCH-001.md §9
#
# For every contract this records, in deployments/testnet.json:
#   network, network_passphrase, contract_id, deploy_tx (tx hash),
#   deploy_ledger (when recoverable from RPC logs), wasm sha256 (source hash),
#   version, toolchain, constructor args (addresses only — never secrets).
#
# If any evidence field cannot be captured, the script FAILS rather than
# writing an unverifiable record (RFC §0 "no fake deployment claims").

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

NETWORK="testnet"
PASSPHRASE="Test SDF Network ; September 2015"
SOURCE="${BRUJULA_CIVICA_DEPLOYER:-brujula-deployer}"
OUT="deployments/testnet.json"
LOG_DIR="deployments/logs"
# Honour CARGO_TARGET_DIR so the build artifacts can live outside the repo (a
# wasm release build is large; /tmp is often a small tmpfs).
CARGO_TARGET_DIR="${CARGO_TARGET_DIR:-$ROOT/target}"
WASM_DIR="$CARGO_TARGET_DIR/wasm32v1-none/release"
mkdir -p deployments "$LOG_DIR"

step() { printf '\n\033[1m== %s ==\033[0m\n' "$*"; }

step "0/6 toolchain"
STELLAR_VER="$(stellar --version | head -1)"
RUSTC_VER="$(rustc -V)"
echo "$STELLAR_VER"; echo "$RUSTC_VER"

step "1/6 deployer key"
if ! stellar keys ls 2>/dev/null | grep -qx "$SOURCE"; then
  echo "generating funded testnet key '$SOURCE'"
  stellar keys generate "$SOURCE" --network "$NETWORK" --fund
fi
ADMIN="$(stellar keys address "$SOURCE")"
echo "admin/source: $ADMIN"

step "2/6 build"
stellar contract build
if [ ! -f "$WASM_DIR/brujula_identity.wasm" ]; then
  echo "FATAL: missing $WASM_DIR/brujula_identity.wasm" >&2; exit 1
fi

sha() { shasum -a 256 "$1" | awk '{print $1}'; }

# Deploy with constructor args (single tx). Captures verbose RPC logs so the
# transaction hash can be extracted as evidence.
deploy_one() {
  local name="$1"; shift
  local wasm="$WASM_DIR/$name.wasm"
  local log="$LOG_DIR/$name-deploy.log"
  echo "--- deploying $name"
  local cid
  if ! cid="$(stellar contract deploy \
      --wasm "$wasm" \
      --source-account "$SOURCE" \
      --network "$NETWORK" \
      --very-verbose -- \
      "$@" 2>"$log")"; then
    echo "FATAL: deploy of $name failed — last log lines:" >&2
    tail -20 "$log" >&2
    exit 1
  fi
  echo "    contract_id: $cid"

  # tx hash: the LAST signed tx is the contract-create (install comes first
  # when the wasm is not yet on-chain)
  local tx
  tx="$(grep -E 'Signing transaction:' "$log" | grep -Eo '\b[0-9a-f]{64}\b' | tail -1 || true)"
  # ledger evidence: confirm against Horizon (testnet), with short retries
  local ledger="" resp
  if [ -n "$tx" ]; then
    for _ in 1 2 3 4 5 6; do
      resp="$(curl -sf --max-time 10 "https://horizon-testnet.stellar.org/transactions/$tx" 2>/dev/null || true)"
      ledger="$(jq -r '.ledger // empty' <<<"$resp" 2>/dev/null || true)"
      [ -n "$ledger" ] && break
      sleep 5
    done
  fi
  [ -z "$ledger" ] && ledger="$(grep -Eo '"ledger"[[:space:]]*:[[:space:]]*[0-9]+' "$log" | tail -1 | grep -Eo '[0-9]+' || true)"

  if [ -z "$tx" ]; then
    echo "FATAL: could not extract deployment tx hash for $name (see $log)" >&2
    exit 1
  fi
  echo "    deploy_tx: $tx"
  echo "    ledger:     ${ledger:-UNKNOWN}"

  # prove the deployed code answers on-chain before recording it
  stellar contract info interface --id "$cid" --network "$NETWORK" >/dev/null
  echo "    on-chain interface check: OK"

  printf '%s\n%s\n%s\n' "$cid" "$tx" "${ledger:-}" > "$LOG_DIR/$name-evidence.txt"
}

step "3/6 deploy contracts (constructor included in deploy tx)"
deploy_one brujula_identity       --admin "$ADMIN"
deploy_one brujula_proposal       --admin "$ADMIN"
deploy_one brujula_accountability --admin "$ADMIN"
IDENTITY_ID="$(sed -n 1p "$LOG_DIR/brujula_identity-evidence.txt")"
PROPOSAL_ID="$(sed -n 1p "$LOG_DIR/brujula_proposal-evidence.txt")"
deploy_one brujula_vote --admin "$ADMIN" --identity "$IDENTITY_ID" --proposal "$PROPOSAL_ID"

step "4/6 write evidence record"
VERSION="$(grep -m1 '^version' contracts/brujula-identity/Cargo.toml | cut -d'"' -f2)"
field() { sed -n "${2}p" "$LOG_DIR/$1-evidence.txt"; }

jq -n \
  --arg network "$NETWORK" \
  --arg passphrase "$PASSPHRASE" \
  --arg source "$ADMIN" \
  --arg generated "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  --arg stellar "$STELLAR_VER" \
  --arg rustc "$RUSTC_VER" \
  --arg version "$VERSION" \
  --arg id_id "$(field brujula_identity 1)" \
  --arg id_tx "$(field brujula_identity 2)" \
  --arg id_led "$(field brujula_identity 3)" \
  --arg id_sha "$(sha "$WASM_DIR/brujula_identity.wasm")" \
  --arg pr_id "$(field brujula_proposal 1)" \
  --arg pr_tx "$(field brujula_proposal 2)" \
  --arg pr_led "$(field brujula_proposal 3)" \
  --arg pr_sha "$(sha "$WASM_DIR/brujula_proposal.wasm")" \
  --arg vo_id "$(field brujula_vote 1)" \
  --arg vo_tx "$(field brujula_vote 2)" \
  --arg vo_led "$(field brujula_vote 3)" \
  --arg vo_sha "$(sha "$WASM_DIR/brujula_vote.wasm")" \
  --arg ac_id "$(field brujula_accountability 1)" \
  --arg ac_tx "$(field brujula_accountability 2)" \
  --arg ac_led "$(field brujula_accountability 3)" \
  --arg ac_sha "$(sha "$WASM_DIR/brujula_accountability.wasm")" \
  '{
    schema: "brujula-civica/deployments@1",
    network: $network,
    network_passphrase: $passphrase,
    source_account: $source,
    generated_at: $generated,
    toolchain: { stellar: $stellar, rustc: $rustc },
    contracts: {
      "brujula-identity":      { version: $version, contract_id: $id_id,  deploy_tx: $id_tx,  deploy_ledger: (if $id_led == "" then null else $id_led end), wasm_sha256: $id_sha },
      "brujula-proposal":      { version: $version, contract_id: $pr_id,  deploy_tx: $pr_tx,  deploy_ledger: (if $pr_led == "" then null else $pr_led end), wasm_sha256: $pr_sha },
      "brujula-vote":          { version: $version, contract_id: $vo_id,  deploy_tx: $vo_tx,  deploy_ledger: (if $vo_led == "" then null else $vo_led end), wasm_sha256: $vo_sha },
      "brujula-accountability":{ version: $version, contract_id: $ac_id,  deploy_tx: $ac_tx,  deploy_ledger: (if $ac_led == "" then null else $ac_led end), wasm_sha256: $ac_sha }
    }
  }' > "$OUT"

step "5/6 verify evidence record"
"$ROOT/scripts/verify-deployment.sh" "$OUT"

step "6/6 done — evidence written to $OUT"
