# Definition of Done — Brújula Cívica (RFC BRUJULA-CIVICA-ARCH-001 §10)

A phase is done **only** when every box is checked with reproducible evidence.
"If it cannot be demonstrated with a transaction, contract state, a
reproducible artifact, or traceable evidence, it is not presented as done."

Status legend: `[x]` proven · `[ ]` not yet true (claimed nowhere).

---

## Global gates (must hold at every point in time)

- [x] `cargo fmt --all --check` passes
- [x] `cargo clippy --all-targets -- -D warnings` passes
- [x] `cargo test` — **49/49** contract tests pass
- [x] `stellar contract build` — 4 wasm artifacts, sha256 recorded in
      `deployments/testnet.json`
- [x] `./scripts/verify-deployment.sh deployments/testnet.json --live` passes
      (record ↔ artifact hashes ↔ live on-chain interface)
- [x] SDK: `pnpm --filter @brugulacivica/sdk test` — **27/27** offline tests
- [x] SDK: `pnpm --filter @brugulacivica/sdk test:live` — **7/7** live testnet tests
- [x] Dashboard: `pnpm --filter @brugulacivica/dashboard test` — **38/38** tests
- [x] Dashboard: typecheck + production build pass
- [x] Every value the dashboard renders is either chain-backed or `DESCONOCIDO`
      (enforced by tests, not by review)
- [x] No README/dashboard/marketing claim lacks evidence (§0 "no fake X" list)

## Phase 0 — Foundation ✅ (this RFC + repo)

- [x] Architecture frozen in [`docs/rfc/BRUJULA-CIVICA-ARCH-001.md`](rfc/BRUJULA-CIVICA-ARCH-001.md)
- [x] Contract interfaces defined as four separate contracts (no god-contract)
- [x] Network configuration: testnet (passphrase + RPC recorded in evidence)
- [x] Evidence model: `deployments/testnet.json`, `deployments/smoke-test.json`
- [x] Threat model: [`docs/threat-model.md`](threat-model.md)

## Phase 1 — Civic Core ✅ (on testnet, with evidence)

- [x] **Identity**: `issue/suspend/reinstate/revoke/set_eligible` — unit-tested;
      issued on-chain, credential ACTIVE·ELIGIBLE readable via SDK
- [x] **Proposal**: `create/status/is_open/attach_evidence/cancel` — unit-tested;
      proposal #1 created on-chain, status OPEN reads back
- [x] **Voting**: `cast_public` + eligibility gate — tested (double vote,
      ineligible, window, unknown proposal, revoked and suspended credentials);
      cast on-chain
- [x] **Tally**: `get_tally` returns state; `verifyTally` → `verified`
      (6/6 deterministic checks) via SDK live test and dashboard
- [x] **Explorer/verifier UI**: fail-closed dashboard, builds and passes its
      own test suite

### Honesty removals in this phase

The previous dashboard shipped UI that contradicted §0. Each was removed, not
reworded, because there was no evidence behind it:

- [x] **Fabricated "Hermes Civic Intelligence" panel** — invented engine, quotes,
      hashes, "12 FUENTES PROCESADAS", "100% IPFS Anclado", "MOTOR AUDITADO".
      Replaced by the real append-only report log from `brujula-accountability`.
- [x] **"Voto secreto garantizado"** on the landing page — exactly the
      fake-anonymity claim §0.2 forbids. Replaced with an explicit statement
      that `public_v1` is transparent and that no ZK mode exists.
- [x] **Credential modal that granted eligibility on click** — `setVerified(true)`
      plus an `alert()`, never touching the chain, telling anyone they could
      vote. Now a real `get_credential` + `is_eligible` lookup with an honest
      outcome per result, covered by tests.
- [x] **Invented citizen identity** ("Sofia Montes", `#REG-04-8921`, a fake DID,
      a fake district) and invented metrics (14 / 4,892 / 38 / 100%). Landing
      metrics now come from `next_id`, the open-proposal count and the anchored
      report count, and render `DESCONOCIDO` when unreadable.
- [x] **Fabricated proposal status default** — an unreadable status rendered as
      "Programada". Now renders `DESCONOCIDO` (pinned by test).
- [x] **Invented proposal ids** — `CIV-2025-<id + 1>`, an off-by-one scheme that
      did not correspond to any chain record. The on-chain id is shown verbatim.

### Functional bugs fixed in this phase

- [x] Dashboard did not compile: 14 TypeScript errors, two undeclared runtime
      dependencies (`stellar-wallet-kit`, `@stellar/stellar-sdk`), and duplicate
      re-exports. `pnpm dev`, `pnpm build` and the CI dashboard job were all red.
- [x] Dashboard was unreachable — `setView` was never called, so the whole
      application sat behind a dead `href="#proposals"` anchor.
- [x] `cast_public` was invoked without its `choice` argument, so every ballot
      would have failed on-chain.
- [x] `cast_public` was sent with `voter: "G..."`, which is not an address.
- [x] Failed transactions produced no user-visible message; errors were only
      `console.error`'d and the form silently reset.
- [x] `toCounts` accepted negative vote counts, returning `status: "ok"` for a
      tally shape the contract cannot produce.
- [x] `@import` of the design tokens resolved to a non-existent path.

## Phase 2 — Evidence ⚙️ partial

- [x] Content hashes + CID anchored on-chain
- [x] Evidence root + report/evidence hashes anchored
- [ ] IPFS upload pipeline for real proposal documents (only placeholder CID now)
- [ ] Provenance dashboard section for off-chain content re-derivation

## Phase 3 — Hermes ⬜ not started (claimed nowhere)

Nothing in the UI claims this. The fabricated Hermes panel was removed precisely
because presenting it here would have been a §0.3 violation.

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