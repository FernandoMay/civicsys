# Definition of Done — CivicSys (RFC CIVICSYS-ARCH-001 §10)

A phase is done **only** when every box is checked with reproducible evidence.
"If it cannot be demonstrated with a transaction, contract state, a
reproducible artifact, or traceable evidence, it is not presented as done."

Status legend: `[x]` proven · `[ ]` not yet true (claimed nowhere).

---

## Global gates (must hold at every point in time)

- [x] `cargo fmt --all --check` passes
- [x] `cargo clippy --all-targets -- -D warnings` passes
- [x] `cargo test` — **28/28** contract tests pass
- [x] `stellar contract build` — 4 wasm artifacts, sha256 recorded in
      `deployments/testnet.json`
- [x] `./scripts/verify-deployment.sh deployments/testnet.json --live` passes
      (record ↔ artifact hashes ↔ live on-chain interface)
- [x] SDK: `pnpm --filter @civicsys/sdk test` — **16/16** offline tests
- [x] SDK: `pnpm --filter @civicsys/sdk test:live` — **7/7** live testnet tests
- [x] Dashboard renders only chain-backed values; everything else shows
      `UNKNOWN` (verified manually against live reads + zero console errors)
- [x] No README/dashboard/marketing claim lacks evidence (§0 "no fake X" list)

## Phase 0 — Foundation ✅ (this RFC + repo)

- [x] Architecture frozen in [`docs/rfc/CIVICSYS-ARCH-001.md`](rfc/CIVICSYS-ARCH-001.md)
- [x] Contract interfaces defined as four separate contracts (no god-contract)
- [x] Network configuration: testnet (passphrase + RPC recorded in evidence)
- [x] Evidence model: `deployments/testnet.json`, `deployments/smoke-test.json`
- [x] Threat model: [`docs/threat-model.md`](threat-model.md)

## Phase 1 — Civic Core ✅ (on testnet, with evidence)

- [x] **Identity**: `issue/suspend/reinstate/revoke/set_eligible` — unit-tested;
      issued on-chain (tx `934e4e44…`), credential ACTIVE·ELIGIBLE readable via SDK
- [x] **Proposal**: `create/status/is_open/attach_evidence/cancel` — unit-tested;
      proposal #1 created on-chain (tx `c81ff0bd…`), status OPEN reads back
- [x] **Voting**: `cast_public` + eligibility gate — tested (double vote,
      ineligible, window, unknown proposal); cast on-chain (tx `025dc14d…`)
- [x] **Tally**: `get_tally` returns state; `verifyTally` → `VERIFIED`
      (6/6 deterministic checks) via SDK live test and dashboard
- [x] **Explorer/verifier UI**: fail-closed dashboard (dev server, this thread)

## Phase 2 — Evidence ⚙️ partial

- [x] Content hashes + CID anchored on-chain (proposal #1)
- [x] Evidence root + report/evidence hashes anchored
      (CivicAccountability report #1, tx `cb01c2ae…`)
- [ ] IPFS upload pipeline for real proposal documents (only placeholder CID now)
- [ ] Provenance dashboard section for off-chain content re-derivation

## Phase 3 — Hermes ⬜ not started (claimed nowhere)

- [ ] Retrieval → evidence set → claims → deterministic verification
- [ ] Report generation with sources/timestamps/hashes
- [ ] On-chain anchoring of real reports (contract already supports it)

## Phase 4 — Privacy ⬜ not started (claimed nowhere)

- [ ] Merkle membership hashing clients
- [ ] ZK verifier contract → mode `zk_v1` (until then: `commitment_v1` = NOT ZK)
- [ ] Sybil-resistance hardening beyond issuer trust

## Phase 5 — Mobile ⬜ not started

- [ ] Flutter ↔ Rust FFI over shared crypto/SDK core

## Mainnet exit criteria (from RFC)

- [ ] Phase 2 complete (real content-addressed evidence)
- [ ] TTL keeper deployed (T14 residual risk closed)
- [ ] Admin key hardening (multisig/timelock — T8)
- [ ] Independent audit of the four contracts
- [ ] Explicit user authorization for production deployment
