# Brújula Cívica Threat Model (v0.1)

| Field | Value |
|---|---|
| Status | Living document — accompanies RFC BRUJULA-CIVICA-ARCH-001 §7 |
| Scope | MVP v0.1: BrujulaIdentity, BrujulaProposal, BrujulaVote, BrujulaAccountability on Stellar Testnet |
| Method | Assets → actors → trust boundaries → threats → mitigations → residual risk |

The governing rule: **a property we cannot demonstrate with evidence is not
claimed.** Where a mitigation is only partial, the residual risk is stated
plainly instead of being papered over.

---

## 1. Assets

| Asset | Where it lives | Why it matters |
|---|---|---|
| Credential commitments & eligibility | BrujulaIdentity contract state | gates who may vote |
| Proposal provenance (hashes, CID, window) | BrujulaProposal contract state | the thing being decided |
| Ballots + tally | BrujulaVote contract state | the decision itself |
| Report / evidence hashes | BrujulaAccountability contract state | post-hoc accountability |
| Deployer/admin keys | local keystore (`.stellar/`, git-ignored) | control of all four contracts |
| Off-chain content | IPFS/Arweave behind CID | actual proposal text & evidence |
| Deployment evidence | `deployments/*.json` (committed) | reproducibility claims |
| Reader trust | RPC endpoint used by SDK/dashboard | what users *see* |

## 2. Actors

| Actor | Capability | Trust level |
|---|---|---|
| Voter | signs txs, holds a credential | untrusted (may be adversarial) |
| Proposer | creates proposals, attaches evidence | untrusted |
| Issuer (admin) | issues/suspends/revokes credentials, sets roots, cancels proposals | **trusted root** (Phase 1) |
| Contract signer set | `set_signers`, `schedule_admin_rotation`, `set_membership_root`, `cancel` | **trusted root**; N-of-N over a signer set, public 24h rotation delay (see T8) |
| RPC operator | serves read state to SDK/dashboard | untrusted for *claims* — see T10 |
| Hermes (Phase 3) | produces reports anchored on-chain | untrusted input, deterministic rules |
| Observer (anyone) | reads chain, re-verifies | the auditor — must need no permission |

## 3. Trust boundaries

```
[Real world / issuer KYC]  --attestation-->  [Issuer key]  --issue()-->  [BrujulaIdentity]
[Off-chain content]        --CID+hash----->  [BrujulaProposal]
[Browser / dashboard]      --reads-------->  [RPC node]    --simulates--> [Contracts]
[Wallet]                   --signs------->  [Stellar network -> contracts]
```

## 4. Threats and mitigations

| # | Threat | Surface | Mitigation | Residual risk |
|---|---|---|---|---|
| T1 | Ballot tampering / forged tally | BrujulaVote | tally is contract state; `verifyTally` checks total = Σcounts = public+commitment, mode consistency; events emitted per ballot; anyone can re-verify against RPC/explorer | reader must trust *some* RPC for display; cross-checkable against Horizon/explorer |
| T2 | Double voting (public mode) | BrujulaVote | persistent per-(proposal, voter) record; second cast traps `AlreadyVoted` (tested) | none known at contract level |
| T3 | Double voting (commitment mode) | BrujulaVote | nullifier uniqueness per proposal; duplicate traps `NullifierUsed` (tested) | none known at contract level |
| T4 | Vote by an ineligible/revoked person | BrujulaVote ← BrujulaIdentity | `cast_public` requires `is_eligible` = ACTIVE ∧ flag; revocation takes effect immediately (tested) | depends on issuer correctness (T6) |
| T5 | Membership forgery in commitment mode | BrujulaVote `cast_commitment` | v0.1 only checks admin-set Merkle root + nullifier — **membership is claimed, not proven** | **ACCEPTED & DISCLOSED**: dashboards surface `UNVERIFIED_COMMITMENT` / mode `commitment_v1` = "NOT ZK"; closed only in Phase 4b by an on-chain ZK verifier |
| T6 | Issuer compromise / rogue issuer | BrujulaIdentity | single admin key, `revoke` is final, all admin actions evented (`CredentialIssued/Revoked`, `AdminChanged`) | **ACCEPTED**: issuer is the identity trust root in Phase 1; multi-issuer registry + transparency log planned |
| T7 | Unauthorized admin calls | all contracts | every mutating fn calls `require_auth()` against stored admin; tested via `set_auths(&[])` negative tests | auth failures surface as invoke errors, not silent success |
| T8 | Admin key compromise | all contracts | N-of-N signer set: every signer must authorise every privileged call, so one leaked key grants nothing. Rotation is scheduled, **public** (`pending_admin_rotation`) and delayed 24h, with cancel. `set_signers` rejects empty/duplicate sets | **PARTIALLY CLOSED**: single-key compromise is neutralised; a full signer-set compromise is still fatal. N-of-N chosen over a threshold because a threshold has a silent-bypass failure mode. Verified live: single-key admin call refused, 2-of-2 cancel and revert submitted |
| T9 | Proposal content swap after voting | BrujulaProposal | title/description/metadata hashes + CID on-chain; content re-derivable and hash-checkable | availability of off-chain storage (IPFS pinning) not guaranteed by chain |
| T10 | Malicious/buggy RPC lies to the dashboard | SDK reads | every SDK read is fail-closed (`ok`/`unknown` with reason); verifier rules are deterministic and re-runnable; evidence includes contract id + ledger so claims are cross-checkable on Horizon/explorer or a second RPC (`BRUJULA_CIVICA_RPC_URL`) | display-level trust in one RPC per fetch; verification is reproducible elsewhere |
| T11 | Fake deployment claims | ops | `deployments/testnet.json` records network, address, tx, ledger, wasm sha256, version; `verify-deployment.sh` recomputes hashes and (with `--live`) proves the contract answers; CI runs both (RFC §9/§10) | record only valid for the committed toolchain pin — bumps require redeploy + new evidence |
| T12 | Claiming ZK/anonymous voting before it exists | product | mode stored in tally is *only* `public_v1`/`commitment_v1` in v0.1; verifier treats `zk_*` as `unknown` even if a flag claims a verifier exists; contract never writes `zk_*` | none — enforced in contract, SDK, and UI |
| T13 | Hermes fabricated/unsupported claims (Phase 3) | off-chain | evidence-set hash anchored in BrujulaAccountability; report statuses limited to SUPPORTED/CONTRADICTED/UNVERIFIED/UNKNOWN; sources+timestamps+content hashes mandatory | not implemented until Phase 3 — nothing claimed now |
| T14 | Record loss via TTL expiry | contract state | extend-on-write (1M ledgers ≈ 58 days). `scripts/ttl-keeper.sh` refreshes the contract **instance** and **wasm** for all four contracts | **PARTIALLY CLOSED**: instance+wasm protected (losing them is unrecoverable). Individual records are NOT refreshed by the keeper: the public testnet RPC exposes no `extendFootprintTtl` and the CLI only accepts symbol or raw-XDR keys, not the composite `DataKey::*` used here. Records rely on extend-on-write. Full closure needs direct RPC access or a contract-level refresh entrypoint |
| T15 | Sybil (one person, many credentials) | identity | issuer enforces one credential per person | **ACCEPTED**: chain cannot detect real-world duplication; issuer is the control |
| T16 | Censoring / delaying a vote tx | network | votes are ordinary txs signed by the voter — any submission path works (stellar CLI, SDK, wallet); fees are minimal on testnet | proposers/admins can cancel proposals (evented), which is a governance decision, not an exploit |
| T17 | Reproducibility drift (build ≠ recorded sha) | CI | Rust toolchain pinned in CI to the version that produced the evidence; `cargo test` + `sha256sum` + verify script on every PR | deliberate toolchain bumps must redeploy and refresh evidence |

## 5. Explicit non-claims (v0.1)

* **Not** end-to-end verifiable mixing, **not** anonymous voting: commitment
  ballots hide the wallet address from the tally but do not prove membership.
* **Not** a substitute for legally binding elections; no ballot-privacy
  guarantee against a coerced voter's own device.
* **Not** an availability guarantee for off-chain content (IPFS pinning is an
  operational concern).
* Hermes does not exist yet: no AI-generated claim is presented anywhere.

## 6. Verification procedures (anyone can run)

```bash
./scripts/verify-deployment.sh deployments/testnet.json --live   # record + on-chain proof
cargo test                                                       # contract behavior
pnpm --filter @brugulacivica/sdk test                                # verifier rules
pnpm --filter @brugulacivica/sdk test:live                           # fail-closed reads vs real chain
```

Every check above is deterministic and requires no privileged access.
