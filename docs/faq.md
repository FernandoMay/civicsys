# CivicSys — FAQ

Short answers, evidence-backed. Anything not yet true is marked as such
(RFC CIVICSYS-ARCH-001 §0.2: "no feature ships with a claim the product cannot
prove").

## What is CivicSys?

Infrastructure for verifiable civic participation: credentials, proposals,
votes and accountability reports anchored on **Stellar/Soroban**, read back
through a fail-closed SDK and rendered with explicit evidence states. The
frozen product definition and architecture live in
[docs/rfc/CIVICSYS-ARCH-001.md](rfc/CIVICSYS-ARCH-001.md).

## What is real and running right now?

- **4 Soroban contracts** deployed on testnet with recorded wasm hashes, deploy
  txs and ledger numbers ([../deployments/testnet.json](../deployments/testnet.json));
  `./scripts/verify-deployment.sh --live` proves they answer on-chain.
- **Full E2E loop executed on-chain**: credential issued → proposal created →
  public vote cast → tally read and **verified by the real verifier**
  (`verdict: verified`, 6/6 checks) → report anchored
  ([../deployments/smoke-test.json](../deployments/smoke-test.json)).
- **`@civicsys/sdk`**: fail-closed reads + pure tally verifier — offline unit
  tests and live testnet tests both green.
- **Dashboard** rendering live reads with `VERIFIED` / `UNKNOWN` states.
- **4 funded testnet identities** for future citizen/voter E2E runs
  ([../deployments/testnet-neighbors.json](../deployments/testnet-neighbors.json)),
  re-verifiable against Horizon (`pnpm test:funding`).

## What is NOT built in v0.1?

- **Hermes evidence engine** — no AI analysis exists; evidence rows are raw
  anchors and hashes only.
- **ZK voting anonymity** — `zk_*` tally modes cannot be produced by the
  contracts; the verifier would report `unknown`, never "verified anonymity".
- **IPFS pinning** — `content_cid` is stored as provenance metadata; content
  availability is not guaranteed.
- **Mainnet** — testnet only.
- **Escrow/fund flows** — proposals carry budgets as data; no money moves.

Full checklist with status: [definition-of-done.md](definition-of-done.md).

## Why does the UI show UNKNOWN instead of a value?

Because CivicSys is **fail-closed**: when a fact cannot be proven from chain
state *right now*, the honest answer is `unknown` with a reason — never a
default, never a guess. Examples: a proposal with no tally yet, a proposal id
that does not exist, an RPC read that failed, or a hypothetical `zk_*` mode
without a verified verifier. See [state-diagram.md](state-diagram.md) §7 for
every state that is intentionally unreachable and what shows instead.

## What do VERIFIED / MISMATCH / UNKNOWN mean?

They are the output of the SDK's 6-check tally verifier — not design labels:

| Verdict | Meaning |
|---|---|
| `verified` | mode recognized, counts well-formed, totals equal sums, mode matches the public/commitment split, no negatives — every check `true` |
| `mismatch` | at least one check demonstrably fails (tampering/corruption) |
| `unknown` | no tally exists, or a property cannot be proven yet |

The dashboard badge, `scripts/tally-verdict.mjs`, and the smoke-test evidence
all run this same code. Rule: a badge may only repeat a computed verdict.
Details: [state-diagram.md](state-diagram.md) §5.

## Is my vote secret?

- **`public_v1` (current default):** no. The ballot is wallet-addressed — one
  vote per (proposal, voter), visible on-chain. This is the honest v0.1 mode.
- **`commitment_v1`:** your choice is recorded as a commitment with a
  one-time nullifier, so it is *separated* from your wallet — but membership is
  **claimed, not proven** in v0.1, so surfaces must show
  **UNVERIFIED_COMMITMENT**, and anonymity is **not** claimed.
- **Verified anonymity (`zk_v1`):** requires the Phase 4 verifier contract and
  a verified deployment record. Until then the verifier answers `unknown` even
  if such a mode appeared.

## How can I verify the claims myself?

```bash
./scripts/verify-deployment.sh deployments/testnet.json --live  # contracts answer on-chain
pnpm --filter @civicsys/sdk test:live                           # SDK reads real contracts
pnpm test:funding                                               # 4 neighbors funded vs Horizon
./scripts/smoke-test.sh                                         # full loop + verifier verdict
node scripts/tally-verdict.mjs 2                                # verdict for proposal 2
node scripts/read-credential.mjs G…                              # credential state for a subject
```

Every command fails non-zero if the evidence does not hold.

## Runbook / artifacts

## Where do I see the raw evidence?

- `deployments/testnet.json` — contracts, wasm sha256, deploy txs, toolchain.
- `deployments/smoke-test.json` — E2E tx hashes, `vote.vote_count`,
  `vote.verdict`, anchored report hashes.
- `deployments/testnet-neighbors.json` — public addresses + Horizon-observed
  balances (no secrets; seeds stay in the local `stellar keys` keystore).
- `deployments/logs/` — verbose invocation logs behind those txs.

## How do I run it locally?

```bash
pnpm install
pnpm dev                 # dashboard (Vite)
pnpm --filter @civicsys/sdk test          # offline verifier tests
pnpm --filter @civicsys/sdk test:live     # live testnet reads (network)
```

Requires Node ≥ 20, pnpm 9, and (for contracts) Rust + the Stellar CLI.

## Who controls the contracts?

Each contract has an `admin` key (issues credentials, cancels proposals, sets
membership roots, rotates itself via `set_admin`). Admin powers are narrow and
evented, but they are real trust: see
[threat-model.md](threat-model.md) for the residual risks and
[state-diagram.md](state-diagram.md) §1–3 for exactly which transitions need
admin auth.
