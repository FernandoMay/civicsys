#!/usr/bin/env bash
set -euo pipefail

# Brújula Cívica — end-to-end smoke test on testnet.
#
# Exercises the full MVP loop against the REAL deployed contracts:
#   issue credential → create proposal → cast public vote → read tally
#   → prove tally consistency with the real SDK verifier (fail-closed verdict)
#   → anchor accountability report → verify consistency.
#
# Writes deployments/smoke-test.json as evidence (tx hashes, ids, results).
# Exits non-zero on any failure — no step is allowed to "pass" unproven.

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

NETWORK="testnet"
KEY="${BRUJULA_CIVICA_DEPLOYER:-brujula-deployer}"
DEPLOY="deployments/testnet.json"
LOG_DIR="deployments/logs"
OUT="deployments/smoke-test.json"
mkdir -p "$LOG_DIR"

step() { printf '\n\033[1m== %s ==\033[0m\n' "$*"; }
die()  { echo "FATAL: $*" >&2; exit 1; }

[ -f "$DEPLOY" ] || die "$DEPLOY not found — run scripts/deploy-testnet.sh first"
command -v jq >/dev/null || die "jq required"

cid_of() { jq -r ".contracts[\"$1\"].contract_id" "$DEPLOY"; }
IDENTITY="$(cid_of brujula-identity)"
PROPOSAL="$(cid_of brujula-proposal)"
VOTE="$(cid_of brujula-vote)"
ACCOUNTABILITY="$(cid_of brujula-accountability)"
ADMIN="$(stellar keys address "$KEY")"

sha256_hex() { printf '%s' "$1" | shasum -a 256 | awk '{print $1}'; }

# invoke(): run a contract function; state-changing calls are submitted and
# signed, reads are simulated. Verbose log kept for tx-hash evidence.
invoke() {
  local log="$1" id="$2"; shift 2
  stellar contract invoke \
    --id "$id" \
    --source-account "$KEY" \
    --network "$NETWORK" \
    --very-verbose -- \
    "$@" 2>"$log"
}
tx_of() { grep -E 'Signing transaction:' "$1" | grep -Eo '\b[0-9a-f]{64}\b' | tail -1 || true; }

step "0/6 preconditions"
stellar keys address "$KEY" >/dev/null || die "missing key $KEY"
echo "admin: $ADMIN"
echo "identity: $IDENTITY"; echo "proposal: $PROPOSAL"
echo "vote:     $VOTE"; echo "accountability: $ACCOUNTABILITY"

step "1/6 issue credential to the deployer"
COMMITMENT="$(sha256_hex "brujula-civica/smoke/commitment/$ADMIN")"
L="$LOG_DIR/smoke-issue.log"
if ! invoke "$L" "$IDENTITY" issue \
  --subject "$ADMIN" \
  --commitment "$COMMITMENT" \
  --credential_type citizen; then
  # Do not parse error strings: PROVE the credential's on-chain state instead.
  echo "issue invoke failed — verifying credential state on-chain (fail-closed)"
  CRED_JSON="$(node scripts/read-credential.mjs "$ADMIN" 2>>"$L")" || { tail -5 "$L"; die "credential read failed"; }
  if [ "$(jq -r .issued <<<"$CRED_JSON")" != "true" ] || [ "$(jq -r .commitment <<<"$CRED_JSON")" != "$COMMITMENT" ]; then
    grep -iE "alreadyissued|error" "$L" | tail -5 || true
    die "issue failed and the credential is not provably on-chain with this commitment"
  fi
  echo "credential already on-chain with this commitment (re-run) — continuing"
fi
ISSUE_TX="$(tx_of "$L")"
echo "issue_tx: ${ISSUE_TX:-UNKNOWN (re-run: credential pre-existed)}"

step "2/6 create proposal (window: past → +1h, so voting is open now)"
NOW="$(date -u +%s)"
TITLE_HASH="$(sha256_hex "Smoke Test Proposal: should the pipeline be considered live?")"
DESC_HASH="$(sha256_hex "Created by scripts/smoke-test.sh to prove the Brújula Cívica loop end-to-end on Stellar testnet.")"
META_HASH="$(sha256_hex '{"kind":"smoke-test"}')"
CID="bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi"
EVIDENCE_ROOT="$(sha256_hex "brujula-civica/smoke/evidence-root/$NOW")"
L="$LOG_DIR/smoke-create.log"
PROPOSAL_ID="$(invoke "$L" "$PROPOSAL" create \
  --proposer "$ADMIN" \
  --title_hash "$TITLE_HASH" \
  --description_hash "$DESC_HASH" \
  --metadata_hash "$META_HASH" \
  --content_cid "$CID" \
  --evidence_root "$EVIDENCE_ROOT" \
  --opens_at "$((NOW - 60))" \
  --closes_at "$((NOW + 3600))")"
PROPOSAL_ID="$(printf '%s' "$PROPOSAL_ID" | tr -cd '0-9')"
[ -n "$PROPOSAL_ID" ] || { tail -10 "$LOG_DIR/smoke-create.log"; die "could not parse proposal id"; }
CREATE_TX="$(tx_of "$L")"
echo "proposal_id: $PROPOSAL_ID  create_tx: ${CREATE_TX:-UNKNOWN}"

step "3/6 cast public vote (choice 0) — requires the credential from step 1"
L="$LOG_DIR/smoke-vote.log"
if ! invoke "$L" "$VOTE" cast_public \
  --proposal_id "$PROPOSAL_ID" \
  --voter "$ADMIN" \
  --choice 0; then
  # Prove the vote landed by reading the tally of THIS (fresh) proposal.
  echo "cast_public invoke failed — verifying tally on-chain (fail-closed)"
  VJ="$(node scripts/tally-verdict.mjs "$PROPOSAL_ID" 2>>"$L")" || { tail -5 "$L"; die "tally read failed"; }
  VC="$(jq -r '.vote_count' <<<"$VJ")"
  if ! [[ "$VC" =~ ^[0-9]+$ && "$VC" -ge 1 ]]; then
    tail -10 "$L"
    die "cast_public failed and no vote is provably on-chain"
  fi
  echo "vote already on-chain (re-run) — continuing"
fi
VOTE_TX="$(tx_of "$L")"
echo "vote_tx: ${VOTE_TX:-UNKNOWN (re-run: vote pre-existed)}"

step "4/6 read tally + status from chain"
L="$LOG_DIR/smoke-tally.log"
TALLY_RAW="$(invoke "$L" "$VOTE" get_tally --proposal_id "$PROPOSAL_ID")" || { tail -10 "$L"; die "get_tally failed"; }
echo "tally: $TALLY_RAW"
L="$LOG_DIR/smoke-status.log"
STATUS_RAW="$(invoke "$L" "$PROPOSAL" status --id "$PROPOSAL_ID")" || { tail -10 "$L"; die "status failed"; }
echo "status: $STATUS_RAW (1 = OPEN)"

# Real verifier verdict — never a decorative label: run the SDK's actual
# tally verifier against a fresh chain read. vote_count comes from that same
# verified read. Fail closed unless every check proves consistency.
[ -d packages/sdk/dist ] || pnpm --filter @brugulacivica/sdk build || die "SDK build failed (required for the verdict step)"
L="$LOG_DIR/smoke-verdict.log"
VERDICT_JSON="$(node scripts/tally-verdict.mjs "$PROPOSAL_ID" 2>"$L")" || { cat "$L" >&2; die "tally-verdict.mjs failed"; }
VOTE_COUNT="$(jq -r '.vote_count' <<<"$VERDICT_JSON")"
VERDICT="$(jq -r '.verdict' <<<"$VERDICT_JSON")"
echo "verdict: $VERDICT  vote_count: $VOTE_COUNT  checks: $(jq -r '.checks | length' <<<"$VERDICT_JSON")"
[ "$VERDICT" = "verified" ] || { jq . <<<"$VERDICT_JSON"; die "tally verdict is '$VERDICT' — fail-closed (smoke test requires proven consistency)"; }
[[ "$VOTE_COUNT" =~ ^[0-9]+$ ]] && [ "$VOTE_COUNT" -ge 1 ] || die "vote_count not a number >= 1: $VOTE_COUNT"

step "5/6 anchor an accountability report"
REPORT_HASH="$(sha256_hex "smoke-report/$PROPOSAL_ID/$NOW")"
EV_HASH="$(sha256_hex "smoke-evidence-set/$PROPOSAL_ID/$NOW")"
L="$LOG_DIR/smoke-anchor.log"
REPORT_ID="$(invoke "$L" "$ACCOUNTABILITY" anchor \
  --proposal_id "$PROPOSAL_ID" \
  --report_hash "$REPORT_HASH" \
  --evidence_hash "$EV_HASH" \
  --kind smoke \
  --author "$ADMIN")" || { tail -10 "$L"; die "anchor failed"; }
REPORT_ID="$(printf '%s' "$REPORT_ID" | tr -cd '0-9')"
ANCHOR_TX="$(tx_of "$L")"
echo "report_id: $REPORT_ID  anchor_tx: ${ANCHOR_TX:-UNKNOWN}"

step "6/6 write evidence"
jq -n \
  --arg generated "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  --arg admin "$ADMIN" \
  --arg commitment "$COMMITMENT" \
  --arg issue_tx "${ISSUE_TX:-}" \
  --argjson proposal_id "$PROPOSAL_ID" \
  --arg create_tx "${CREATE_TX:-}" \
  --arg vote_tx "${VOTE_TX:-}" \
  --argjson vote_count "$VOTE_COUNT" \
  --arg verdict "$VERDICT" \
  --arg status "$STATUS_RAW" \
  --argjson report_id "${REPORT_ID:-0}" \
  --arg anchor_tx "${ANCHOR_TX:-}" \
  --arg report_hash "$REPORT_HASH" \
  --arg evidence_hash "$EV_HASH" \
  '{
    schema: "brujula-civica/smoke-test@1",
    generated_at: $generated,
    admin: $admin,
    credential_commitment: $commitment,
    issue_tx: (if $issue_tx == "" then null else $issue_tx end),
    proposal: { id: $proposal_id, create_tx: $create_tx, status_on_chain: $status },
    vote: { tx: $vote_tx, vote_count: $vote_count, verdict: $verdict },
    report: { id: $report_id, anchor_tx: $anchor_tx, report_hash: $report_hash, evidence_hash: $evidence_hash }
  }' > "$OUT"
echo "evidence written: $OUT"
jq . "$OUT"
echo
echo "SMOKE TEST PASSED — loop proven on $NETWORK (proposal $PROPOSAL_ID)."
