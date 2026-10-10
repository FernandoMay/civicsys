# Brújula Cívica — working notes

## Done and verified

- `./scripts/smoke-test.sh` — full E2E loop (credential → proposal → vote →
  tally + real verifier verdict → anchored report) on testnet
- `pnpm --filter @brugulacivica/sdk test` — 69 offline tests (verifier,
  chain-shape normalisers, hashing, Merkle membership)
- `pnpm --filter @brugulacivica/hermes test` — 49 deterministic-evidence tests,
  including retrieval against a real HTTP server
- `pnpm --filter @brugulacivica/sdk test:live` — live testnet reads
- `pnpm --filter @brugulacivica/sdk test:funding` — funded neighbours vs Horizon
- `pnpm --filter @brugulacivica/dashboard test` — 50 fail-closed rendering,
  wallet-boundary and commitment-disclosure tests
- `pnpm hermes:anchor` — real retrieval → deterministic report → on-chain
  anchor, verified by reading it back
- `pnpm commitment:demo` — full `commitment_v1` flow: Merkle root published,
  commitment ballot cast, tally read back
- `./scripts/verify-deployment.sh deployments/testnet.json --live`
- `./scripts/ttl-keeper.sh` — instance + wasm TTL refresh for all four contracts

## Open, with reasons

- [ ] **ZK verifier → `zk_v1` (Phase 4b).** Not attempted on purpose. A real
      proof system is a research-grade dependency; shipping anything labelled
      `zk_v1` without one is exactly the fake-anonymity claim RFC §0.2 forbids.
      The residual risk stays open and is disclosed in the UI.
- [ ] **Admin key hardening (T8):** multisig or timelock. Still a single EOA per
      contract. Requires a contract change plus a redeploy.
- [ ] **Per-record TTL refresh.** The keeper covers instance + wasm. Individual
      records rely on extend-on-write, because the public testnet RPC exposes no
      `extendFootprintTtl` and the CLI only accepts symbol or raw-XDR keys, not
      the composite `DataKey::*` keys used here.
- [ ] **IPFS upload pipeline (Phase 2).** Proposal CIDs are still a constant;
      there is no upload step and no off-chain re-derivation in the UI.
- [ ] **Automatic claim extraction (Phase 3).** Today the operator declares the
      literal claims to check. There is no extraction from unstructured prose.
- [ ] Remove the duplicated design tokens (`design/` and `packages/design/`
      carry identical files; the dashboard reads the root one)