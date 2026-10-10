# Brújula Cívica — working notes

## Done and verified

- `./scripts/smoke-test.sh` — full E2E loop (credential → proposal → vote →
  tally + real verifier verdict → anchored report) on testnet
- `pnpm --filter @brugulacivica/sdk test` — offline verifier + normaliser tests
- `pnpm --filter @brugulacivica/sdk test:live` — live testnet reads
- `pnpm --filter @brugulacivica/sdk test:funding` — funded neighbours vs Horizon
- `pnpm --filter @brugulacivica/dashboard test` — fail-closed rendering and
  wallet-boundary tests
- `./scripts/verify-deployment.sh deployments/testnet.json --live` — evidence
  record ↔ wasm hashes ↔ on-chain interface

## Open

- [ ] Phase 2: real IPFS upload pipeline (the CID on chain is still a constant)
- [ ] Phase 2: provenance section that re-derives off-chain content by CID/hash
- [ ] Phase 3: Hermes retrieval → claims → verification (deliberately not
      started; nothing in the UI claims it exists)
- [ ] Phase 4: Merkle membership clients + ZK verifier contract (`zk_v1`)
- [ ] TTL keeper for long-lived records (T14 residual risk)
- [ ] Admin key hardening: multisig or timelock (T8)
- [ ] Remove the duplicated design tokens (`design/` and `packages/design/`
      carry identical files; the dashboard reads the root one)