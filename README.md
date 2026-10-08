# CivicSys

**Civic decisions. Verifiable by design.**

CivicSys is verifiable civic-participation infrastructure:
*propose → deliberate → decide → verify*. It is not "blockchain for
elections" — it is an open infrastructure layer where participation,
evidence, decisions and accountability can be **independently verified**.

> CivicSys doesn't ask you to trust the system. It gives you evidence to verify it.

Source of truth: [`docs/rfc/CIVICSYS-ARCH-001.md`](docs/rfc/CIVICSYS-ARCH-001.md)
· Threat model: [`docs/threat-model.md`](docs/threat-model.md) ·
Definition of done: [`docs/definition-of-done.md`](docs/definition-of-done.md)

## Honesty guarantees (frozen, RFC §0)

| We do NOT claim | What exists instead |
|---|---|
| "ZK / anonymous voting" | `public_v1` (transparent) and `commitment_v1` (**privacy-preserving commitment, not ZK**) until a verifier contract exists (Phase 4) |
| "AI says this is true" | Hermes doesn't exist yet; nothing AI-flavored is presented |
| "Powered by blockchain" as a feature | the chain has exactly one job: tamper-evident public verification |
| Deployment "done" without proof | every contract carries address + tx + ledger + wasm sha256 + version in committed evidence |

**Fail-closed rule:** anything not readable from chain state renders as
`UNKNOWN` — never an invented zero, default, or optimistic state.

## Architecture

```
        IDENTITY            DELIBERATION           DECISION
     CivicIdentity             Hermes            CivicProposal
     commitments            (Phase 3)            content + CID
     eligibility                                   window
          │                     │                     │
          └──────────┬──────────┴──────────┬──────────┘
                     │                     │
               CivicVote ◄────────► CivicAccountability
               ballots/nullifier/  immutable report hashes
               tally                    │
                     └──── Stellar / Soroban ──── TX / events ──► PUBLIC VERIFIER
                                                                    (SDK + dashboard)
```

Four small contracts (never one god-contract), Soroban SDK 25:

| Contract | Responsibility | Crate |
|---|---|---|
| `CivicIdentity` | credential commitments, eligibility, revocation | [`contracts/civic-identity`](contracts/civic-identity) |
| `CivicProposal` | provenance: hashes + CID + open/close window | [`contracts/civic-proposal`](contracts/civic-proposal) |
| `CivicVote` | ballots, nullifiers, tally, honest mode labels | [`contracts/civic-vote`](contracts/civic-vote) |
| `CivicAccountability` | append-only report anchoring | [`contracts/civic-accountability`](contracts/civic-accountability) |

## Live evidence — Stellar Testnet

Committed machine-readable records: [`deployments/testnet.json`](deployments/testnet.json)
· [`deployments/smoke-test.json`](deployments/smoke-test.json)

### Deployments (v0.1.0, 2026-10-08)

| Contract | Contract ID | Deploy tx | Ledger |
|---|---|---|---|
| civic-identity | [`CDOOF4WZVM77IFLPP3RN7S5LCWUCR57LJ325OZMLD2D5OFSIPUL4WDNU`](https://stellar.expert/explorer/testnet/contract/CDOOF4WZVM77IFLPP3RN7S5LCWUCR57LJ325OZMLD2D5OFSIPUL4WDNU) | [`5816c57c…e2f1867b`](https://stellar.expert/explorer/testnet/tx/5816c57c0d5178639b943fb700b4cdce4bd0bc899b214b5e5f421c20e2f1867b) | 5094327 |
| civic-proposal | [`CBDCXSSLCGJW53HU5URXMERNGY342ECABFWU6PH4LBSMEMLM7BLK4DOF`](https://stellar.expert/explorer/testnet/contract/CBDCXSSLCGJW53HU5URXMERNGY342ECABFWU6PH4LBSMEMLM7BLK4DOF) | [`07dbb670…5a7a718b`](https://stellar.expert/explorer/testnet/tx/07dbb6706db18ce333e23bdc17e11a60648b02a1d18648d7ea648f065a7a718b) | 5094330 |
| civic-vote | [`CCOAEQ7ZHMRVMZYJLVAGLRITSBE73JJDI4EYS4NEZQ7XKLXJMQ35SBTZ`](https://stellar.expert/explorer/testnet/contract/CCOAEQ7ZHMRVMZYJLVAGLRITSBE73JJDI4EYS4NEZQ7XKLXJMQ35SBTZ) | [`e0238f7c…113a57e5`](https://stellar.expert/explorer/testnet/tx/e0238f7cc1695d382fc75607d351c286ffeb1ddc1f7e174b21f828e9113a57e5) | 5094336 |
| civic-accountability | [`CDYL4GI6ZRMZDVJAZCTCU2O5RQXPYL3472M4YEM544HKYUFWT5TNKT5S`](https://stellar.expert/explorer/testnet/contract/CDYL4GI6ZRMZDVJAZCTCU2O5RQXPYL3472M4YEM544HKYUFWT5TNKT5S) | [`ce0ae7b0…f504d92ff`](https://stellar.expert/explorer/testnet/tx/ce0ae7b096413e3f5ca16419e59aa967c48d4aed1f8db5985bc9417f504d92ff) | 5094334 |

### End-to-end smoke test (credential → proposal → vote → tally → report)

| Step | Evidence |
|---|---|
| Issue credential | tx [`934e4e44…edb268616`](https://stellar.expert/explorer/testnet/tx/934e4e44a0a3295bf3f78ff4772562c87a3d5ec6aa3988a8b9a4be3edb268616) |
| Create proposal #1 (window OPEN) | tx [`c81ff0bd…7eb2a53ea`](https://stellar.expert/explorer/testnet/tx/c81ff0bd636999882fbce815bcf43f1c2c9df94734c8820f659a27a7eb2a53ea) |
| Cast public vote (eligibility-gated) | tx [`025dc14d…574d9697`](https://stellar.expert/explorer/testnet/tx/025dc14d1a179d59a86a4541c12f013205edc789063af37004dd6d32574d9697) |
| Tally read back + verified | `total=1, counts={0:1}, public_v1` → verifier **VERIFIED** (6/6 checks) |
| Anchor accountability report #1 | tx [`cb01c2ae…ac8f2214`](https://stellar.expert/explorer/testnet/tx/cb01c2ae6c5f4698b566c4bdf901866c8f1ae137f2b93f083eeb02bcac8f2214) |

Reproduce the full loop: `./scripts/smoke-test.sh` (writes `deployments/smoke-test.json`).

## Repository

```
civicsys/
├── docs/rfc/CIVICSYS-ARCH-001.md   # frozen architecture — source of truth
├── docs/threat-model.md             # assets, threats, residual risks
├── docs/definition-of-done.md       # per-phase evidence checklist
├── contracts/                       # Rust workspace: 4 Soroban contracts
├── packages/sdk/                    # @civicsys/sdk — fail-closed reads + verifier
├── apps/dashboard/                  # Vite + React verifier UI (fail-closed)
├── scripts/                         # deploy / verify / smoke (evidence-first)
└── deployments/                     # committed evidence records
```

## Quickstart

Prereqs: Rust (stable), `stellar` CLI, Node ≥ 20 + pnpm 9, `jq`.

```bash
# contracts
cargo test                                   # 28 tests
stellar contract build                        # 4 wasm artifacts + hashes

# sdk
pnpm install
pnpm --filter @civicsys/sdk test              # 16 offline verifier tests
pnpm --filter @civicsys/sdk test:live         # 7 live testnet reads

# dashboard (fail-closed UI against testnet)
pnpm dev                                      # http://127.0.0.1:5173

# evidence
./scripts/verify-deployment.sh deployments/testnet.json          # artifacts ↔ record
./scripts/verify-deployment.sh deployments/testnet.json --live   # + on-chain proof

# (re)deploy — writes fresh evidence with tx hashes + ledgers
./scripts/deploy-testnet.sh
./scripts/smoke-test.sh
```

Anyone can verify without our tooling: open the tx/contract links above in
Stellar Explorer and recompute `sha256sum` of the wasm artifacts.

## SDK usage

```ts
import { CivicReader, loadDeployment, verifyTally } from "@civicsys/sdk/node";

const reader = new CivicReader(loadDeployment("deployments/testnet.json"));

const status = await reader.proposalStatus(1n);
// → { status: "ok", value: 1, evidence: { contractId, ledger, fetchedAt } }
// → or { status: "unknown", reason } — never a fabricated default

const verdict = await reader.verifyTally(1n);
// → verified | mismatch | unknown, with every check itemized
```

## Roadmap

Phase 0 Foundation ✅ → Phase 1 Civic Core ✅ (on testnet) →
Phase 2 Evidence (real IPFS pipeline) → Phase 3 Hermes (anchored audit
reports) → Phase 4 Privacy (ZK verifier → `zk_v1`) → Phase 5 Mobile
(Flutter ↔ Rust FFI core).

Deferred from v0.1 by design: ZK anonymous voting, advanced credentials,
cross-chain, mobile wallet, governance DAO, institutional integrations.
