#!/usr/bin/env bash
set -euo pipefail

# Brújula Cívica — end-to-end smoke test on testnet.
#
# Exercises the full MVP loop against the REAL deployed contracts:
#   credential → proposal → public vote → tally → verifier verdict → anchor.
#
# IDEMPOTENCE (why this script looks the way it does)
# ----------------------------------------------------
# Re-running this must not accumulate effects. It therefore separates:
#
#   * IRREVERSIBLE operations, executed ONCE per fixture and then PROVED BY
#     READING: creating the proposal, casting the vote, anchoring the report.
#   * READ-ONLY checks, executed every run: proposal status, tally, verifier.
#
# The proposal is a *fixture*, not just "some open proposal". It is identified
# by a stable title hash, so it can never collide with a real consultation or
# with the commitment/audit flows that use their own proposals. Its id is
# recorded in deployments/smoke-fixture.json, and can also be recovered by
# scanning the chain for the marker if that file is lost.
#
# Everything the script asserts is proven by reading chain state. It never
# treats a failed invocation as proof, and never parses error text to decide
# that an effect is present.
#
# Three-way reads: every decision point distinguishes
#   (a) READ OK + matches      → reuse, no new effect;
#   (b) READ OK + does not match → perform the irreversible step once;
#   (c) READ FAILED             → die. A failed read must never be treated as
#       "absent", because that is exactly how duplicates accumulate: an
#       unreadable-but-present effect looks identical to a missing one.

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

NETWORK="testnet"
KEY="${BRUJULA_CIVICA_DEPLOYER:-brujula-deployer}"
DEPLOY="deployments/testnet.json"
LOG_DIR="deployments/logs"
OUT="deployments/smoke-test.json"
FIXTURE="deployments/smoke-fixture.json"
mkdir -p "$LOG_DIR"

# Stable marker. Deliberately contains NO timestamp: the fixture must be
# identifiable across runs and across machines.
FIXTURE_TITLE_HASH="$(printf '%s' 'brujula-civica/smoke-fixture/title/v1' | shasum -a 256 | awk '{print $1}')"
FIXTURE_META_HASH="$(printf '%s' '{"kind":"smoke-fixture","version":1}' | shasum -a 256 | awk '{print $1}')"
FIXTURE_DESC_HASH="$(printf '%s' 'Fixture proposal owned by scripts/smoke-test.sh. Not a real consultation.' | shasum -a 256 | awk '{print $1}')"
FIXTURE_EVIDENCE_ROOT="$(printf '%s' 'brujula-civica/smoke-fixture/evidence-root/v1' | shasum -a 256 | awk '{print $1}')"
FIXTURE_CID="bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi"
# Window long enough that ordinary re-runs land on the same fixture.
FIXTURE_WINDOW_SECONDS=604800

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

# --- read-only helpers (never mutate) ---------------------------------------
#
# read_fn prints the contract's answer on stdout and returns 0 on a successful
# read (even when the answer is null/false), 1 when the READ ITSELF failed.
# Callers must handle all three outcomes; see the header comment.
read_fn() {
  local cid="$1"; shift
  stellar contract invoke --id "$cid" --source-account "$KEY" \
    --network "$NETWORK" -- "$@" 2>/dev/null
}

# Prints the proposal id if $1 exists AND is the smoke fixture AND is open.
# Exit codes: 0 match; 1 read-ok-but-not-a-match; 2 read failed.
fixture_matches() {
  local id="$1" pj status title rc
  pj="$(read_fn "$PROPOSAL" get --id "$id")"; rc=$?
  [ "$rc" = 0 ] || return 2
  printf '%s' "$pj" | grep -q '^{' || return 1
  title="$(printf '%s' "$pj" | jq -r '.title_hash' 2>/dev/null)" || return 2
  [ "$title" = "$FIXTURE_TITLE_HASH" ] || return 1
  status="$(read_fn "$PROPOSAL" status --id "$id")" || return 2
  status="$(printf '%s' "$status" | tr -cd '0-9')"
  [ "$status" = "1" ]
}

# Deterministic recovery: find the fixture by its marker, newest first.
# Prints the id, if found. Dies if any read failed, because creating a new
# proposal while the chain is unreadable is how duplicates are born.
scan_for_fixture() {
  local next i rc found=""
  next="$(read_fn "$PROPOSAL" next_id)"; rc=$?
  [ "$rc" = 0 ] || die "cannot read next_id — refusing to create blindly (would risk a duplicate proposal)"
  next="$(printf '%s' "$next" | tr -cd '0-9')"
  [ -n "$next" ] || die "cannot parse next_id — refusing to create blindly"
  for (( i = next - 1; i >= 1; i-- )); do
    if fixture_matches "$i"; then
      found="$i"; break
    elif [ $? = 2 ]; then
      die "read of proposal #$i failed mid-scan — refusing to create blindly (would risk a duplicate proposal)"
    fi
  done
  [ -n "$found" ] && echo "$found" && return 0
  return 1
}

step "0/7 preconditions"
stellar keys address "$KEY" >/dev/null || die "missing key $KEY"
echo "admin:          $ADMIN"
echo "identity:       $IDENTITY"
echo "proposal:       $PROPOSAL"
echo "vote:           $VOTE"
echo "accountability: $ACCOUNTABILITY"
echo "fixture marker: ${FIXTURE_TITLE_HASH:0:16}…"

step "1/7 credential (irreversible once; re-runs prove it by reading)"
COMMITMENT="$(sha256_hex "brujula-civica/smoke/commitment/$ADMIN")"
L="$LOG_DIR/smoke-issue.log"
if ! invoke "$L" "$IDENTITY" issue \
  --subject "$ADMIN" \
  --commitment "$COMMITMENT" \
  --credential_type citizen; then
  echo "issue invoke failed — verifying credential state on-chain (fail-closed)"
  CRED_JSON="$(node scripts/read-credential.mjs "$ADMIN" 2>>"$L")" || { tail -5 "$L"; die "credential read failed"; }
  if [ "$(jq -r .issued <<<"$CRED_JSON")" != "true" ] || [ "$(jq -r .commitment <<<"$CRED_JSON")" != "$COMMITMENT" ]; then
    grep -iE "alreadyissued|error" "$L" | tail -5 || true
    die "issue failed and the credential is not provably on-chain with this commitment"
  fi
  echo "credential already on-chain with this commitment — not re-issued"
fi
ISSUE_TX="$(tx_of "$L")"
echo "issue_tx: ${ISSUE_TX:-UNKNOWN (credential pre-existed)}"

step "2/7 fixture proposal (irreversible once; re-runs reuse it)"
NOW="$(date -u +%s)"
REUSED_FIXTURE=0
CREATE_TX=""

PROPOSAL_ID=""
if [ -f "$FIXTURE" ]; then
  PROPOSAL_ID="$(jq -r '.proposal_id // empty' "$FIXTURE" 2>/dev/null || true)"
  if [ -n "$PROPOSAL_ID" ]; then
    fixture_matches "$PROPOSAL_ID"
    rc=$?
    if [ "$rc" = 0 ]; then
      REUSED_FIXTURE=1
      echo "reusing fixture proposal #$PROPOSAL_ID (recorded in $FIXTURE, still open)"
    elif [ "$rc" = 2 ]; then
      echo "recorded fixture #$PROPOSAL_ID is UNREADABLE — will try chain recovery before deciding"
      PROPOSAL_ID=""
    else
      echo "recorded fixture #$PROPOSAL_ID is unusable (missing, not ours, or closed)"
      PROPOSAL_ID=""
    fi
  fi
fi

if [ "$REUSED_FIXTURE" = 0 ]; then
  # File lost: recover deterministically from the chain before creating.
  if PROPOSAL_ID="$(scan_for_fixture)"; then
    REUSED_FIXTURE=1
    echo "recovered fixture proposal #$PROPOSAL_ID by scanning for the marker"
  fi
fi

if [ "$REUSED_FIXTURE" = 0 ]; then
  L="$LOG_DIR/smoke-create.log"
  PROPOSAL_ID="$(invoke "$L" "$PROPOSAL" create \
    --proposer "$ADMIN" \
    --title_hash "$FIXTURE_TITLE_HASH" \
    --description_hash "$FIXTURE_DESC_HASH" \
    --metadata_hash "$FIXTURE_META_HASH" \
    --content_cid "$FIXTURE_CID" \
    --evidence_root "$FIXTURE_EVIDENCE_ROOT" \
    --opens_at "$((NOW - 60))" \
    --closes_at "$((NOW + FIXTURE_WINDOW_SECONDS))")"
  PROPOSAL_ID="$(printf '%s' "$PROPOSAL_ID" | tr -cd '0-9')"
  [ -n "$PROPOSAL_ID" ] || { tail -10 "$LOG_DIR/smoke-create.log"; die "could not parse proposal id"; }
  CREATE_TX="$(tx_of "$L")"
  echo "created fixture proposal #$PROPOSAL_ID  create_tx: ${CREATE_TX:-UNKNOWN}"
else
  echo "no new proposal created this run"
fi

# Persist the fixture id so future runs do not have to scan. Merge into the
# existing record (if any) rather than rewriting it, so report_id and history
# survive a run that only re-validates the proposal.
MERGE_BASE="{}"
[ -f "$FIXTURE" ] && MERGE_BASE="$(cat "$FIXTURE")"
jq -n --argjson base "$MERGE_BASE" --argjson id "$PROPOSAL_ID" \
  --arg tx "${CREATE_TX:-}" --arg created "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  '$base + {schema:"brujula-civica/smoke-fixture@1", proposal_id:$id,
    create_tx:(if $tx=="" then ($base.create_tx // null) else $tx end),
    title_hash:"'"$FIXTURE_TITLE_HASH"'",
    first_seen:($base.first_seen // $created)}' \
  > "$FIXTURE.tmp" && mv "$FIXTURE.tmp" "$FIXTURE"

step "3/7 public vote (irreversible once; re-runs prove it by reading)"
L="$LOG_DIR/smoke-vote.log"
ALREADY_VOTED="$(read_fn "$VOTE" has_voted_public --proposal_id "$PROPOSAL_ID" --voter "$ADMIN")" \
  || die "cannot read has_voted_public — refusing to vote blindly (a failed read is not proof of absence)"
ALREADY_VOTED="$(printf '%s' "$ALREADY_VOTED" | tr -cd 'a-zA-Z')"
[ "$ALREADY_VOTED" = "true" ] || [ "$ALREADY_VOTED" = "false" ] \
  || die "has_voted_public returned an unparseable answer: '$ALREADY_VOTED'"
VOTE_TX=""
if [ "$ALREADY_VOTED" = "true" ]; then
  echo "this account already voted on #$PROPOSAL_ID — NOT casting again"
  echo "the vote below is proven by reading has_voted_public and the tally"
else
  if ! invoke "$L" "$VOTE" cast_public \
    --proposal_id "$PROPOSAL_ID" \
    --voter "$ADMIN" \
    --choice 0; then
    tail -10 "$L" >&2
    die "cast_public failed and no prior vote is provable on-chain"
  fi
  VOTE_TX="$(tx_of "$L")"
  echo "cast vote on #$PROPOSAL_ID  vote_tx: ${VOTE_TX:-UNKNOWN}"
fi

step "4/7 read tally + status from chain (read-only)"
L="$LOG_DIR/smoke-tally.log"
TALLY_RAW="$(invoke "$L" "$VOTE" get_tally --proposal_id "$PROPOSAL_ID")" || { tail -10 "$L"; die "get_tally failed"; }
echo "tally: $TALLY_RAW"
L="$LOG_DIR/smoke-status.log"
STATUS_RAW="$(invoke "$L" "$PROPOSAL" status --id "$PROPOSAL_ID")" || { tail -10 "$L"; die "status failed"; }
echo "status: $STATUS_RAW (1 = OPEN)"

# Real verifier verdict — never a decorative label.
[ -d packages/sdk/dist ] || pnpm --filter @brugulacivica/sdk build || die "SDK build failed (required for the verdict step)"
L="$LOG_DIR/smoke-verdict.log"
VERDICT_JSON="$(node scripts/tally-verdict.mjs "$PROPOSAL_ID" 2>"$L")" || { cat "$L" >&2; die "tally-verdict.mjs failed"; }
VOTE_COUNT="$(jq -r '.vote_count' <<<"$VERDICT_JSON")"
VERDICT="$(jq -r '.verdict' <<<"$VERDICT_JSON")"
echo "verdict: $VERDICT  vote_count: $VOTE_COUNT  checks: $(jq -r '.checks | length' <<<"$VERDICT_JSON")"
[ "$VERDICT" = "verified" ] || { jq . <<<"$VERDICT_JSON"; die "tally verdict is '$VERDICT' — fail-closed (smoke test requires proven consistency)"; }
[[ "$VOTE_COUNT" =~ ^[0-9]+$ ]] && [ "$VOTE_COUNT" -ge 1 ] || die "vote_count not a number >= 1: $VOTE_COUNT"

# The vote must be attributable to the account the fixture expects, otherwise
# a tally of 1 could belong to somebody else entirely.
HAS_VOTED_NOW="$(read_fn "$VOTE" has_voted_public --proposal_id "$PROPOSAL_ID" --voter "$ADMIN")" \
  || die "cannot re-read has_voted_public for the attribution check"
HAS_VOTED_NOW="$(printf '%s' "$HAS_VOTED_NOW" | tr -cd 'a-zA-Z')"
[ "$HAS_VOTED_NOW" = "true" ] || die "the fixture account does not hold a vote on #$PROPOSAL_ID"
echo "attribution check: has_voted_public($ADMIN) = true"

step "5/7 accountability anchor (irreversible once; re-runs prove it by reading)"
# Report hashes are derived from the proposal id ONLY — no timestamp — so the
# same fixture always yields the same digests and the anchor is stable.
REPORT_HASH="$(sha256_hex "brujula-civica/smoke/report/$PROPOSAL_ID")"
EV_HASH="$(sha256_hex "brujula-civica/smoke/evidence-set/$PROPOSAL_ID")"
REPORT_ID=""
ANCHOR_TX=""

if [ -f "$FIXTURE" ]; then
  REPORT_ID="$(jq -r '.report_id // empty' "$FIXTURE" 2>/dev/null || true)"
fi

# Fixture lost (or pointing elsewhere): the chain is the source of truth, not
# the file. Scan the log newest-first for these exact digests before anchoring.
if [ -z "$REPORT_ID" ]; then
  COUNT="$(read_fn "$ACCOUNTABILITY" count)" \
    || die "cannot read the report count — refusing to anchor blindly (would risk a duplicate report)"
  COUNT="$(printf '%s' "$COUNT" | tr -cd '0-9')"
  [ -n "$COUNT" ] || die "cannot parse the report count — refusing to anchor blindly"
  i="$COUNT"
  while [ "$i" -ge 1 ]; do
    CAND="$(read_fn "$ACCOUNTABILITY" get --report_id "$i")" \
      || die "read of report #$i failed mid-scan — refusing to anchor blindly (would risk a duplicate report)"
    if printf '%s' "$CAND" | jq -e --arg rh "$REPORT_HASH" --arg eh "$EV_HASH" \
         --argjson pid "$PROPOSAL_ID" \
         '.report_hash == $rh and .evidence_hash == $eh and .proposal_id == $pid and .kind == "smoke"' \
         >/dev/null 2>&1; then
      REPORT_ID="$i"
      echo "recovered anchor #$REPORT_ID from the chain log (same digests) — NOT anchoring again"
      break
    fi
    i=$((i - 1))
  done
fi

if [ -n "$REPORT_ID" ]; then
  # Three-way: read-ok+match → reuse; read-ok+mismatch → anchor once;
  # read-failed → DIE. The third case is what used to silently re-anchor and
  # accumulate duplicate reports: an unreadable-but-present anchor looks
  # exactly like a missing one.
  if ! ONCHAIN_REPORT="$(read_fn "$ACCOUNTABILITY" get --report_id "$REPORT_ID")"; then
    die "cannot read report #$REPORT_ID — refusing to anchor blindly (would risk a duplicate report)"
  fi
  if printf '%s' "$ONCHAIN_REPORT" | jq -e --arg rh "$REPORT_HASH" --arg eh "$EV_HASH" \
       '.report_hash == $rh and .evidence_hash == $eh' >/dev/null 2>&1; then
    echo "report #$REPORT_ID already anchored with these digests — NOT anchoring again"
  else
    echo "report #$REPORT_ID does not match the expected digests — will anchor once"
    REPORT_ID=""
  fi
fi

if [ -z "$REPORT_ID" ]; then
  L="$LOG_DIR/smoke-anchor.log"
  REPORT_ID="$(invoke "$L" "$ACCOUNTABILITY" anchor \
    --proposal_id "$PROPOSAL_ID" \
    --report_hash "$REPORT_HASH" \
    --evidence_hash "$EV_HASH" \
    --kind smoke \
    --author "$ADMIN")" || { tail -10 "$L"; die "anchor failed"; }
  REPORT_ID="$(printf '%s' "$REPORT_ID" | tr -cd '0-9')"
  ANCHOR_TX="$(tx_of "$L")"
  echo "anchored report #$REPORT_ID  anchor_tx: ${ANCHOR_TX:-UNKNOWN}"
else
  echo "no new anchor this run"
fi

MERGE_BASE="{}"
if [ -f "$FIXTURE" ]; then
  MERGE_BASE="$(cat "$FIXTURE")"
fi
jq -n --argjson base "$MERGE_BASE" --argjson id "$PROPOSAL_ID" \
  --arg tx "${ANCHOR_TX:-}" --argjson rid "${REPORT_ID:-0}" \
  '$base + {report_id:$rid, anchor_tx:(if $tx=="" then ($base.anchor_tx // null) else $tx end)}' \
  > "$FIXTURE.tmp" && mv "$FIXTURE.tmp" "$FIXTURE"

step "6/7 cross-check the anchor on chain (read-only)"
ONCHAIN="$(read_fn "$ACCOUNTABILITY" get --report_id "$REPORT_ID")" \
  || die "cannot re-read report #$REPORT_ID for the cross-check"
printf '%s' "$ONCHAIN" | jq -e --arg rh "$REPORT_HASH" --arg eh "$EV_HASH" \
  '.report_hash == $rh and .evidence_hash == $eh and .kind == "smoke"' >/dev/null \
  || { echo "on-chain report: $ONCHAIN" >&2; die "anchored report does not match the expected digests"; }
echo "on-chain report #$REPORT_ID matches the recorded digests"

step "7/7 write evidence"
jq -n \
  --arg generated "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  --arg admin "$ADMIN" \
  --arg commitment "$COMMITMENT" \
  --arg issue_tx "${ISSUE_TX:-}" \
  --argjson proposal_id "$PROPOSAL_ID" \
  --argjson reused "$REUSED_FIXTURE" \
  --arg create_tx "${CREATE_TX:-}" \
  --arg vote_tx "${VOTE_TX:-}" \
  --argjson vote_count "$VOTE_COUNT" \
  --arg verdict "$VERDICT" \
  --arg status "$STATUS_RAW" \
  --argjson report_id "$REPORT_ID" \
  --arg anchor_tx "${ANCHOR_TX:-}" \
  --arg report_hash "$REPORT_HASH" \
  --arg evidence_hash "$EV_HASH" \
  '{
    schema: "brujula-civica/smoke-test@2",
    generated_at: $generated,
    admin: $admin,
    credential_commitment: $commitment,
    issue_tx: (if $issue_tx == "" then null else $issue_tx end),
    proposal: {
      id: $proposal_id,
      reused_existing: ($reused == 1),
      create_tx: (if $create_tx == "" then null else $create_tx end)
    },
    vote: {
      tx: (if $vote_tx == "" then null else $vote_tx end),
      cast_this_run: ($vote_tx != ""),
      vote_count: $vote_count,
      verdict: $verdict,
      attributed_to_admin: true
    },
    report: {
      id: $report_id,
      anchor_tx: (if $anchor_tx == "" then null else $anchor_tx end),
      anchored_this_run: ($anchor_tx != ""),
      report_hash: $report_hash,
      evidence_hash: $evidence_hash
    }
  }' > "$OUT"

echo "evidence written: $OUT"
echo "fixture written:  $FIXTURE"
jq . "$OUT"
echo
if [ "$REUSED_FIXTURE" = 1 ] && [ -z "$CREATE_TX" ] && [ -z "$VOTE_TX" ] && [ -z "$ANCHOR_TX" ]; then
  echo "SMOKE TEST PASSED — loop proven on $NETWORK (proposal $PROPOSAL_ID), fully idempotent: no new effects this run."
else
  echo "SMOKE TEST PASSED — loop proven on $NETWORK (proposal $PROPOSAL_ID)."
fi