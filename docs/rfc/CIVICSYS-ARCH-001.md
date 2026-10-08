# CIVICSYS-ARCH-001 — CivicSys Stellar Architecture

| Field | Value |
|---|---|
| Status | **ACCEPTED (frozen)** |
| Date | 2026-10-08 |
| Version | 1.0.0 |
| Supersedes | CivicSys MVP (zkTanenbaum / legacy stack) |
| Network | Stellar Testnet first → Mainnet only after Phase 2 exit criteria |

This RFC is the **single source of truth** for CivicSys. Any implementation that
contradicts this document is a bug in the implementation, not in this document.
Amendments require a new RFC (`CIVICSYS-ARCH-00X`) referencing this one.

---

## 0. Product definition

**CivicSys** is verifiable civic-participation infrastructure:
*propose → deliberate → decide → verify*.

Positioning (governing sentence):

> CivicSys doesn't ask you to trust the system. It gives you evidence to verify it.

Tagline: **Civic decisions. Verifiable by design.**

Target uses (MVP): citizen consultations, participatory budgets, community /
association / university / DAO decisions, local-government pilots.
Explicitly **not** positioned as "blockchain for government elections".

### The four pillars

```
① Identity      ② Deliberation     ③ Decision          ④ Accountability
person            proposal           vote                 execution
 ↓                ↓                  ↓                    ↓
credential        evidence           Soroban tx           report hash
 ↓                ↓                  ↓                    ↓
eligibility       Hermes (auditor)   immutable event      anchored on-chain
```

### Frozen "what we will NOT do" list

1. **No blockchain theater.** The chain has exactly one job: tamper-evident
   public verification. "Powered by blockchain" is never a feature bullet.
2. **No fake anonymity.** Until a real proof system exists the mode is called
   *privacy-preserving commitment* (`commitment_v1`), never "ZK" or "anonymous".
3. **No fake AI verification.** Hermes never says "this claim is true"; it says
   "this claim is supported by these sources under these verification rules".
4. **No fake deployment claims.** Every deployed contract carries an evidence
   record: network, contract address, deployment tx, ledger, source hash,
   version. If it cannot be shown, it is reported as `UNKNOWN`, never as done.

**Definition of done (global):** if it cannot be demonstrated with a
transaction, contract state, a reproducible artifact, or traceable evidence,
it is not presented as done.

---

## 1. Domain model

```
Person ──issues──▶ Credential ──grants──▶ Eligibility
                                              │
Proposal ◀──references── Evidence(CID, hash)  │
   │                                          │
   ├──opens_at/closes_at──▶ VotingWindow ◀────┘
   │                            │
   │                       Vote(choice, weight)
   │                        ├── mode: public  (Address, one per voter)
   │                        └── mode: commitment_v1 (nullifier, no address)
   │                            │
   ├──▶ Tally(counts, total)
   │
   └──▶ AccountabilityReport(report_hash, evidence_hash, author, ts)  [append-only]
```

Core aggregates: `Credential`, `Proposal`, `Vote/Tally`, `Report`.
Every aggregate stores **hashes of content, never content itself** (except the
IPFS CID string, which is itself a content address).

### Status derivations (never stored as mutable truth when computable)

* `Proposal.status` is **computed** from `opens_at/closes_at/now` plus an
  explicit `cancelled` flag: `SCHEDULED → OPEN → CLOSED`, or `CANCELLED`.
* `Credential.status` is stored because revocation is an event of record:
  `0=ACTIVE, 1=SUSPENDED, 2=REVOKED`.

---

## 2. On-chain vs off-chain data model

| Data | Location | Why |
|---|---|---|
| Credential commitment (BLS12-381/SHA-256 style 32-byte digest) | on-chain | eligibility anchor |
| Credential status + timestamps | on-chain | revocation is public record |
| Proposal id, title/description/metadata hashes, evidence root, CID, window | on-chain | tamper-evident summary |
| Full proposal text, attachments | off-chain (IPFS/Arweave), addressed by CID | cost + usability |
| Vote choice, nullifier, tally | on-chain | the decision itself |
| Ballot metadata (IP, device, email) | **never collected** | minimization |
| Hermes raw sources + retrieval logs | off-chain (object storage) | volume |
| Hermes report + evidence-set hash | hash on-chain (CivicAccountability) | anchoring |
| Deploy evidence (address, tx, ledger, source hash) | off-chain `deployments/*.json`, hash of file committed to repo | reproducibility |

Storage discipline (all contracts):

* instance storage: admin + config;
* persistent storage: records, keyed by id/address, **TTL extended on every
  write** (`threshold/extend` chosen so records survive ≥ 30 days without a
  keeper; a keeper/indexer must refresh long-lived records in production);
* temporary storage: never used for records of record.

---

## 3. Soroban contract set

Four contracts, four crates. No god-contract. Cross-contract reads go through
generated clients (`civic-vote` depends on `civic-identity` and
`civic-proposal` crates).

### 3.1 civic-identity — `CivicIdentity`

Responsibility: credential commitments, eligibility, revocation.

```text
__constructor(admin: Address)
issue(subject: Address, commitment: Bytes32, credential_type: Symbol)   [admin]
suspend(subject: Address)                                               [admin]
reinstate(subject: Address)                                             [admin]
revoke(subject: Address, reason_hash: Bytes32)                          [admin]
set_eligible(subject: Address, eligible: bool)                          [admin]
set_admin(new_admin: Address)                                           [admin]
get_credential(subject: Address) -> Option<Credential>
is_eligible(subject: Address) -> bool        // ACTIVE && eligible_flag
admin() -> Address
```

`Credential = { subject, commitment, credential_type, status, eligible, issued_at, updated_at }`

Events: `credential_issued`, `credential_suspended`, `credential_revoked`,
`credential_reinstated`, `eligibility_changed`, `admin_changed`.

### 3.2 civic-proposal — `CivicProposal`

Responsibility: proposal provenance and lifecycle windows.

```text
__constructor(admin: Address)
create(proposer: Address, title_hash, description_hash, metadata_hash: Bytes32,
       content_cid: String, evidence_root: Bytes32,
       opens_at: u64, closes_at: u64) -> u64                 // returns proposal_id
get(id: u64) -> Option<Proposal>
status(id: u64) -> u32            // computed: 0 SCHEDULED, 1 OPEN, 2 CLOSED, 3 CANCELLED
is_open(id: u64) -> bool
attach_evidence(id: u64, evidence_hash: Bytes32, source: Symbol) [proposer]
cancel(id: u64, reason_hash: Bytes32)                        [admin]
set_admin(new_admin: Address)                                [admin]
```

`Proposal = { proposer, title_hash, description_hash, metadata_hash,
content_cid, evidence_root, created_at, opens_at, closes_at, cancelled,
cancel_reason_hash }`. `proposal_id` is a monotonically increasing `u64`.

Events: `proposal_created`, `proposal_evidence_attached`,
`proposal_cancelled`, `admin_changed`.

Validation: `opens_at < closes_at`, `closes_at > now`, hashes are 32 bytes,
CID length ≤ 128.

### 3.3 civic-vote — `CivicVote`

Responsibility: ballots, nullifiers, tally. Reads eligibility from
`CivicIdentity` and open-window from `CivicProposal`.

```text
__constructor(admin: Address, identity: Address, proposal: Address)
cast_public(proposal_id: u64, voter: Address, choice: u32)   // eligible & open & once
set_membership_root(proposal_id: u64, root: Bytes32)         [admin]
cast_commitment(proposal_id: u64, choice: u32, nullifier: Bytes32,
                commitment: Bytes32, membership_root: Bytes32,
                verifier_digest: Bytes32)                    // open & unseen nullifier
get_tally(proposal_id: u64) -> Option<Tally>
has_voted_public(proposal_id: u64, voter: Address) -> bool
nullifier_seen(proposal_id: u64, nullifier: Bytes32) -> bool
set_admin(new_admin: Address)                                [admin]
```

`Tally = { proposal_id, total, counts: Map<u32,u64>, public_votes,
commitment_votes, verification_mode }`

**Honesty rule encoded in state:** `verification_mode` is a stored symbol.
It is `public_v1` for public ballots and **`commitment_v1`** for commitment
ballots. It is **never** `zk_*` until a verifier contract exists; upgrading the
mode requires a new contract version + RFC amendment.

`cast_commitment` in v0.1 verifies only: window open, `membership_root`
equals the admin-set root for that proposal, nullifier unseen. The
`commitment`/`verifier_digest` fields are recorded as *claims pending proof*
and are surfaced as `UNVERIFIED_COMMITMENT` by the SDK/verifier. The ZK phase
(Phase 4) replaces this entrypoint with `cast_zk` + verifier address.

Events: `vote_cast_public`, `vote_cast_commitment`, `membership_root_set`.

### 3.4 civic-accountability — `CivicAccountability`

Responsibility: append-only anchoring of reports and evidence sets.

```text
__constructor(admin: Address)
anchor(proposal_id: u64, report_hash: Bytes32, evidence_hash: Bytes32,
       kind: Symbol, author: Address) -> u64                 // returns report_id
get(report_id: u64) -> Option<Report>
count() -> u64
set_admin(new_admin: Address)                                [admin]
```

`Report = { proposal_id, report_hash, evidence_hash, kind, author, anchored_at }`

Immutable: there is no update/delete function. Corrections are new reports.
Events: `report_anchored`.

---

## 4. Identity / credential model

```
real-world identity ──(issuer KYC/attestation off-chain)──▶
credential commitment c = H(domain ‖ subject_secret ‖ attrs)
        │
        ▼
CivicIdentity.issue(subject, c)          // chain knows only c
        │
        ▼
eligibility = status==ACTIVE && eligible_flag
```

* The chain never sees name/DNI/email.
* `subject` is a Stellar `Address` (wallet). Linking wallet ↔ commitment is
  done by the issuer off-chain and is the trust root of Phase 1.
* Issuer compromise is the main identity threat → mitigated by explicit
  issuer registry in later phase, revocation today (`revoke`, `reinstate`).
* Sybil resistance = one credential per person, enforced by the issuer, NOT
  by the chain (documented honestly).

## 5. Anonymous voting protocol (phased)

| Phase | Mechanism | Mode label | Claim allowed |
|---|---|---|---|
| 1 | wallet vote, one per address | `public_v1` | transparent, not private |
| 4a | commitment + nullifier + Merkle membership, no proof | `commitment_v1` | privacy-preserving commitment, **not ZK** |
| 4b | + ZK proof verified on-chain by a verifier contract | `zk_v1` | anonymous (only then) |

Nullifier derivation (4a): `n = H(voter_secret ‖ proposal_id)` computed
off-chain; double-vote prevention = nullifier uniqueness check. This hides the
voter address from the tally but **does not** prove membership without a proof
— hence `UNVERIFIED_COMMITMENT` status in the verifier.

## 6. Hermes evidence protocol

```
WEB / DOCS / DATA → RETRIEVAL → EVIDENCE SET → CLAIM EXTRACTION
      → VERIFICATION (deterministic rules) → REPORT
      → evidence_hash = H(canonical JSON of evidence set)
      → anchor(report_hash, evidence_hash) in CivicAccountability
```

Rules:

* Every claim in a report carries: sources[], retrieved_at, content hashes,
  verification rule id, status ∈ {SUPPORTED, CONTRADICTED, UNVERIFIED}.
* Hermes never emits `TRUE`. Report status vocabulary is fixed:
  `SUPPORTED / CONTRADICTED / UNVERIFIED / UNKNOWN`.
* The dashboard renders `UNKNOWN` whenever on-chain or evidence data is
  missing (fail-closed). No optimistic defaults, ever.

## 7. Threat model (summary; full doc in docs/threat-model.md)

| Threat | Surface | Mitigation |
|---|---|---|
| Ballot tampering | contract | immutable events + tally in contract state; verified against tx history |
| Double voting (public) | contract | per-(proposal, voter) record |
| Double voting (commitment) | contract | nullifier uniqueness |
| Forged eligibility | identity issuer | revocation + issuer transparency; documented trust root |
| Membership forgery (4a) | commitment mode | **accepted residual risk in 4a**, disclosed as UNVERIFIED_COMMITMENT; closed in 4b by ZK proof |
| Proposal content swap | off-chain storage | CID + content hash on-chain |
| Report fabrication | Hermes | evidence hash anchored; sources stored with hashes |
| Fake deployment claims | ops | deployments/*.json evidence + source hash, CI-verified |
| Admin key compromise | contracts | single admin per contract, `set_admin` evented; multi-sig/timelock = Phase 3+ |
| Front-running / censoring | network | public mempool: votes are txs; censored txs retryable by voter |
| TTL expiry of records | ops | extend-on-write + keeper (§2) |

## 8. Repository structure

```
civicsys/
├── docs/
│   ├── rfc/CIVICSYS-ARCH-001.md        # this document
│   ├── threat-model.md
│   └── definition-of-done.md
├── contracts/                           # Cargo workspace (soroban-sdk 25)
│   ├── civic-identity/
│   ├── civic-proposal/
│   ├── civic-vote/
│   └── civic-accountability/
├── packages/
│   └── sdk/                             # @civicsys/sdk — TS client + fail-closed verifier
├── apps/
│   └── dashboard/                       # Vite + React, fail-closed UI
├── scripts/
│   ├── deploy-testnet.sh                # builds, deploys, writes deployments/*.json
│   └── verify-deployment.sh             # re-checks evidence records
├── deployments/                         # evidence: address, tx, ledger, source hash, version
└── .github/workflows/ci.yml             # fmt, clippy, test, wasm build, sdk test, evidence check
```

## 9. Testnet deployment strategy

1. `scripts/deploy-testnet.sh` builds all four contracts (`stellar contract build`),
   deploys to Testnet, invokes `__constructor`, and writes
   `deployments/testnet.json` containing per contract:
   `{ name, version, network, network_passphrase, contract_id, deploy_tx,
      ledger, constructor_tx, source_pubkey, source_hash (sha256 of wasm),
      wasm_sha256, deployed_at }`.
2. The same file's `source_hash` must match `sha256sum` of the wasm artifact in
   CI (`verify-deployment.sh`), otherwise CI fails → no unverifiable claims.
3. Keys: testnet-only keys under `.stellar/` (git-ignored). Mainnet requires a
   separate explicit, user-authorized procedure (out of scope for v0.1).
4. Explorer links are derived from network + contract id, never hardcoded.

## 10. Definition of done (per phase)

A phase is done only when all are true:

* [ ] Code merged with `cargo fmt --check`, `clippy -D warnings`, all tests green.
* [ ] WASM artifacts built and their sha256 recorded.
* [ ] Every contract interaction demonstrated by a test or testnet tx.
* [ ] `deployments/testnet.json` present and `verify-deployment.sh` passes.
* [ ] Dashboard shows `UNKNOWN` for any data not backed by chain state.
* [ ] README/claims contain no feature that lacks evidence (§0 list).

## 11. Roadmap (unchanged from product plan)

* **Phase 0 Foundation** — this RFC, interfaces, threat model. ✅ with this doc
* **Phase 1 Civic Core** — 4 contracts + tests + explorer dashboard
* **Phase 2 Evidence** — IPFS/CID pipeline, evidence registry, audit dashboard
* **Phase 3 Hermes** — retrieval → claims → verification → anchored reports
* **Phase 4 Privacy** — Merkle membership + ZK verifier (`zk_v1`), sybil hardening
* **Phase 5 Mobile** — Flutter ↔ Rust FFI over shared crypto/SDK core

Deferred out of v0.1: ZK anonymous voting, advanced credentials, cross-chain,
mobile wallet, governance DAO, institutional integrations.
