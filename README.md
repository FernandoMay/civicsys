# Brújula Cívica

**Civic decisions. Verifiable by design.**

Brújula Cívica is verifiable civic-participation infrastructure:
*propose → deliberate → decide → verify*. It is not "blockchain for
elections" — it is an open infrastructure layer where participation,
evidence, decisions and accountability can be **independently verified**.

> Brújula Cívica doesn't ask you to trust the system. It gives you evidence to verify it.

Source of truth: [`docs/rfc/BRUJULA-CIVICA-ARCH-001.md`](docs/rfc/BRUJULA-CIVICA-ARCH-001.md)
· Threat model: [`docs/threat-model.md`](docs/threat-model.md) ·
Definition of done: [`docs/definition-of-done.md`](docs/definition-of-done.md) ·
State diagrams: [`docs/state-diagram.md`](docs/state-diagram.md) ·
FAQ: [`docs/faq.md`](docs/faq.md)

## Honesty guarantees (frozen, RFC §0)

| We do NOT claim | What exists instead |
|---|---|
| "ZK / anonymous voting" | `public_v1` (transparent) and `commitment_v1` (**privacy-preserving commitment, not ZK**) until a verifier contract exists (Phase 4b) |
| "AI says this is true" | Hermes is a **deterministic** engine: literal claims checked against retrieved, content-hashed sources. No model, no judgement, reproducible digests |
| "Powered by blockchain" as a feature | the chain has exactly one job: tamper-evident public verification |
| Deployment "done" without proof | every contract carries address + tx + ledger + wasm sha256 + version in committed evidence |

**Fail-closed rule:** anything not readable from chain state renders as
`UNKNOWN` — never an invented zero, default, or optimistic state.

## Architecture

```
        IDENTITY            DELIBERATION           DECISION
     BrujulaIdentity             Hermes            BrujulaProposal
     commitments            (Phase 3)            content + CID
     eligibility                                   window
          │                     │                     │
          └──────────┬──────────┴──────────┬──────────┘
                     │                     │
               BrujulaVote ◄────────► BrujulaAccountability
               ballots/nullifier/  immutable report hashes
               tally                    │
                     └──── Stellar / Soroban ──── TX / events ──► PUBLIC VERIFIER
                                                                    (SDK + dashboard)
```

Four small contracts (never one god-contract), Soroban SDK 25:

| Contract | Responsibility | Crate |
|---|---|---|
| `BrujulaIdentity` | credential commitments, eligibility, revocation | [`contracts/brujula-identity`](contracts/brujula-identity) |
| `BrujulaProposal` | provenance: hashes + CID + open/close window | [`contracts/brujula-proposal`](contracts/brujula-proposal) |
| `BrujulaVote` | ballots, nullifiers, tally, honest mode labels | [`contracts/brujula-vote`](contracts/brujula-vote) |

Admin authority on every contract is **N-of-N** over a signer set, with a
public 24h delay on rotation — see [Admin keys](#admin-keys--n-of-n-with-a-public-timelocked-rotation).
| `BrujulaAccountability` | append-only report anchoring | [`contracts/brujula-accountability`](contracts/brujula-accountability) |

## Live evidence — Stellar Testnet

Committed machine-readable records: [`deployments/testnet.json`](deployments/testnet.json)
· [`deployments/smoke-test.json`](deployments/smoke-test.json)
· [`deployments/testnet-neighbors.json`](deployments/testnet-neighbors.json)

### Deployments (v0.1.0, 2026-10-10)

Deployed with rustc 1.99.0 + Stellar CLI 28.1.0 (both pinned in CI — bumping
either invalidates these wasm hashes and requires a re-deploy).

| Contract | Contract ID | Deploy tx | Ledger |
|---|---|---|---|
| brujula-identity | [`CAYXQI2PR3UTEDU2JYJUMTVPB7M3NXM7YH4YJ45ONY264FUBP5ZLJXTS`](https://stellar.expert/explorer/testnet/contract/CAYXQI2PR3UTEDU2JYJUMTVPB7M3NXM7YH4YJ45ONY264FUBP5ZLJXTS) | [`c41cd298…a86482`](https://stellar.expert/explorer/testnet/tx/c41cd2982eeb4d30052954d71cfb8f683f5710e94e38208c7fcc81b5c7a86482) | 5128285 |
| brujula-proposal | [`CC5M2DNOAOG4J3IT3XZPXZXLKBZRABTTIY5XJPDNYBUEAJE5SEZRDHAI`](https://stellar.expert/explorer/testnet/contract/CC5M2DNOAOG4J3IT3XZPXZXLKBZRABTTIY5XJPDNYBUEAJE5SEZRDHAI) | [`406a6a16…ceece2`](https://stellar.expert/explorer/testnet/tx/406a6a16898e2af01f630380f0162244f65aef74d539671931b15cb043ceece2) | 5128288 |
| brujula-accountability | [`CDTDTN3EKOXXPPIX5AP36SWCKQZPRMAGXOAUWUXDWU3LGLKWJBECIHV4`](https://stellar.expert/explorer/testnet/contract/CDTDTN3EKOXXPPIX5AP36SWCKQZPRMAGXOAUWUXDWU3LGLKWJBECIHV4) | [`de7cbe95…17c74c`](https://stellar.expert/explorer/testnet/tx/de7cbe956417cd285bab0da885a70f8cbe65edb975fe959a3318047d1d17c74c) | 5128290 |
| brujula-vote | [`CCAC5O34PRORFLCXP5VBVJBGHDT25D3VASMN4SEY752RHKUKSU2JWNTP`](https://stellar.expert/explorer/testnet/contract/CCAC5O34PRORFLCXP5VBVJBGHDT25D3VASMN4SEY752RHKUKSU2JWNTP) | [`f304c0af…740e88`](https://stellar.expert/explorer/testnet/tx/f304c0afc131e31dc2336544ba06e5cf9643c66167a5a024de41fa1d23740e88) | 5128292 |

### End-to-end smoke test (credential → proposal → vote → tally → report)

Latest run — proposal **#1** against the deployments above, exactly as recorded
in `deployments/smoke-test.json`:

| Step | Evidence |
|---|---|
| Issue credential | commitment `bad1553b…913ce2`, issuance tx [`253523e1…104d32`](https://stellar.expert/explorer/testnet/tx/253523e13fe89fcc57054588f627d67838858ec31a3e1b6a21bc018458104d32) |
| Create proposal #1 (window OPEN) | tx [`74326087…d12edd`](https://stellar.expert/explorer/testnet/tx/7432608767b06a06a8b3948d5467c6ee889f5fb4bbbbe42e698133a544d12edd) |
| Cast public vote (eligibility-gated) | tx [`1af3c997…8b8404`](https://stellar.expert/explorer/testnet/tx/1af3c997f2b34bc909f7776cb6432e593e7eb7de46e7da6c3e6cbfd7ba6b8404) |
| Tally read back + verified | `total=1, counts={0:1}, public_v1` → **`verdict: verified` (6/6 checks)**, `vote_count: 1` written into the evidence file by the real verifier (`scripts/tally-verdict.mjs`) |
| Anchor accountability report #1 | tx [`0363a7de…0657a81c`](https://stellar.expert/explorer/testnet/tx/0363a7de37b7ce3cf8d253b4239556df886b573d24a4005c7665b9001657a81c) |

Reproduce the full loop: `./scripts/smoke-test.sh` (writes
`deployments/smoke-test.json`; re-runs are idempotent — already-issued and
already-cast steps are **proved by on-chain reads**, not by parsing error text).

## Admin keys — N-of-N with a public, timelocked rotation

Threat T8 was a single EOA per contract. Each contract now holds a **signer
set**, and every privileged call requires **all** signers to authorise.

```bash
# inspect (any of the four contracts)
pnpm admin:signers show --contract brujula-identity --keys brujula-deployer

# widen to two keys (every CURRENT signer must sign the change)
pnpm admin:signers set --contract brujula-identity \
  --keys brujula-deployer --new-keys brujula-deployer,brujula-admin-2 --send

# a rotation is scheduled, public, and delayed 24h before it takes effect
pnpm admin:signers schedule --contract brujula-identity \
  --keys brujula-deployer --to G… --send
pnpm admin:signers cancel  --contract brujula-identity --keys brujula-deployer --send
pnpm admin:signers execute --contract brujula-identity --keys brujula-deployer --send
```

**Why N-of-N and not a threshold.** A threshold needs an M-of-N signing
ceremony, and a bug while counting the authorised set is a *silent
authorisation bypass*. Requiring every signer keeps the check to plain
`require_auth()` calls, which fail closed by construction. The honest
trade-off: adding a signer requires all of them to sign.

`pending_admin_rotation` is public, so a scheduled rotation is observable for a
full day before it lands, and the outgoing signers can still cancel it.

> **Tooling note.** `stellar contract invoke` signs with the source account plus
> at most one extra key, so it **cannot** operate a multi-signer contract — it
> fails with *"Missing signing key"*. That is the enforcement working, not a
> bug. `scripts/admin-signers.ts` assembles the transaction with one
> authorisation per signer via the SDK's `signAuthEntries`. Secrets are read
> from the local `stellar keys` keystore at call time and never written to disk.

Verified live on testnet: widened 1 → 2 signers, a single-key admin call was
refused, then a 2-of-2 cancellation and a 2-of-2 revert were both submitted.

## Hermes — deterministic evidence verification

Not an AI system. Hermes retrieves real sources, hashes exactly what it
retrieved, and checks literal claims against them under explicit, named rules.
Same sources in, same report out, on any machine — which is what makes the
on-chain anchor worth anything.

```
FUENTES → RETRICCIÓN → CONJUNTO DE EVIDENCIA → VERIFICACIÓN → REPORTE
             │                │                    │           │
      sha256 del cuerpo   JSON canónico     SUPPORTED /    report_hash
                          + hash sha256    CONTRADICTED /  evidence_hash
                                           UNVERIFIED            │
                                                  anchor en BrujulaAccountability
```

El vocabulario de estado es fijo y `TRUE` **no** está en él: Hermes informa
`SUPPORTED` / `CONTRADICTED` / `UNVERIFIED` / `UNKNOWN`, nunca "esto es cierto".

Dos reglas fail-closed que los tests fijan:

- una fuente que no se pudo recuperar produce `UNVERIFIED`, nunca
  `CONTRADICTED` — un documento inalcanzable no es evidencia de ausencia;
- `evidence_hash` cubre el **contenido** recuperado, no la marca de tiempo de
  la descarga. Incluir la cabecera HTTP `Date` hacía que el digest cambiara en
  cada ejecución, lo que habría vuelto el anclaje irreproducible para terceros.

```bash
pnpm hermes            # ejecuta con hermes.config.json, escribe evidencia local
pnpm hermes:anchor     # …y ancla report_hash + evidence_hash en testnet
pnpm commitment:demo   # flujo commitment_v1 completo: raíz Merkle + boleta
pnpm ttl:keep          # refresca instance + wasm de los cuatro contratos
```

Prueba en vivo: reporte `#5` anclado en testnet y leído de vuelta con
`BrujulaAccountability.get(5)`, ambos digests coincidentes. Las boletas
`commitment_v1` se informan como `UNVERIFIED_COMMITMENT` — el contrato
comprueba la raíz y el nullificador, **no** la pertenencia.

## Repository

```
brujula-civica/
├── docs/rfc/BRUJULA-CIVICA-ARCH-001.md   # frozen architecture — source of truth
├── docs/threat-model.md             # assets, threats, residual risks
├── docs/definition-of-done.md       # per-phase evidence checklist
├── docs/state-diagram.md            # every state machine + disabled states
├── docs/faq.md                      # honest Q&A (real vs not built)
├── contracts/                       # Rust workspace: 4 Soroban contracts
├── packages/sdk/                    # @brugulacivica/sdk — fail-closed reads, verifier, hashing, membership
├── packages/hermes/                 # @brugulacivica/hermes — deterministic evidence verification (no AI)
├── apps/dashboard/                  # Vite + React verifier UI (fail-closed)
├── scripts/                         # deploy / verify / smoke / hermes / commitment / ttl / fund
└── deployments/                     # committed evidence records
```

## Quickstart

Prereqs: Rust (stable, pinned 1.99.0), `stellar` CLI (pinned 28.1.0),
Node ≥ 20 + pnpm 9, `jq`.

```bash
# contracts
cargo test                                   # 56 tests
stellar contract build                       # 4 wasm artifacts + hashes

# sdk + hermes
pnpm install
pnpm --filter @brugulacivica/sdk test              # 69 offline tests (verifier, hashing, membership)
pnpm --filter @brugulacivica/hermes test           # 49 deterministic-evidence tests (real HTTP)
pnpm --filter @brugulacivica/sdk test:live         # 7 live testnet reads
pnpm --filter @brugulacivica/sdk test:funding      # 4 funded neighbours checked vs Horizon (fail-closed)

# dashboard (fail-closed UI against testnet)
pnpm --filter @brugulacivica/dashboard test   # 50 render + wallet + commitment tests
pnpm dev                                      # http://127.0.0.1:5173

# evidence
./scripts/verify-deployment.sh deployments/testnet.json          # artifacts ↔ record
./scripts/verify-deployment.sh deployments/testnet.json --live   # + on-chain proof
./scripts/ttl-keeper.sh                                         # instance + wasm TTL

# (re)deploy — writes fresh evidence with tx hashes + ledgers
./scripts/deploy-testnet.sh
./scripts/smoke-test.sh

# evidence pipeline
pnpm hermes:anchor                            # deterministic report → on chain
pnpm commitment:demo                          # commitment_v1 end-to-end

# testnet identities for citizen/voter E2E runs (friendbot + Horizon proof)
pnpm fund:neighbors                            # writes deployments/testnet-neighbors.json
```

The dashboard needs a wallet extension (Freighter) to sign a ballot. Everything
else — reading proposals, tallies, credentials and anchored reports — is
public and works with no wallet at all.

Anyone can verify without our tooling: open the tx/contract links above in
Stellar Explorer and recompute `sha256sum` of the wasm artifacts.

## SDK usage

```ts
import { BrujulaReader, loadDeployment, verifyTally } from "@brugulacivica/sdk/node";

const reader = new BrujulaReader(loadDeployment("deployments/testnet.json"));

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
