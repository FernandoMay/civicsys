# Functional dashboard setup

This document covers runtime configuration for the proposal publishing flow. It is intentionally separate from CI configuration.

## Proposal publication

The dashboard's **Crear iniciativa** flow performs these operations:

1. Validates title, description, metadata JSON, and the voting window in the browser.
2. Serializes the content using `brujula-civica/proposal-content@1`.
3. Calls `/.netlify/functions/pin-proposal` to pin the exact JSON bytes to IPFS.
4. Hashes title, description, and the raw metadata string with SHA-256.
5. Asks the connected Stellar wallet to sign the `brujula-proposal.create` transaction.
6. Re-reads the newly allocated proposal record and checks its CID, proposer, and three hashes before displaying a verified success message.

A failed chain transaction can leave an unreferenced IPFS object behind. The UI says so and does not automatically resubmit the transaction, avoiding accidental duplicate proposals.

## Required runtime secret

Configure `PINATA_JWT` as a **Netlify function environment variable** for the production and deploy-preview contexts where publication should be enabled. Do not put the JWT in `VITE_*` variables or in frontend code: those values are public in the browser bundle.

Without `PINATA_JWT`, the function returns an explicit `503` and the UI will not pretend that the content was uploaded. For local testing, run the dashboard through Netlify Dev with `PINATA_JWT` available to the local functions process; a plain Vite dev server does not provide Netlify Functions.

## Abuse-control caveat

The function validates same-origin requests and limits content to 64 KiB. Its current per-IP rate limit is in-memory and is only a best-effort guard; it is **not a durable distributed rate limiter** across serverless instances. Before opening high-volume public publishing, add a shared rate-limit store and provider-side usage limits/alerts. The wallet signature protects the on-chain create operation, not the cost of the preceding IPFS upload.

## Integrity status in the UI

The proposal detail retrieves the content through public IPFS gateways and recomputes the three SHA-256 values. It renders the text only after all hashes match the on-chain record. Gateway failures are `UNKNOWN`; invalid payloads or differing hashes are `MISMATCH`. Neither state is presented as verified.

## Still not complete

The existing contracts store evidence hashes and report hashes, but do not persist a retrievable CID for each evidence/report object. A UI upload alone cannot make those objects discoverable from the chain. Completing evidence/report creation end-to-end requires an explicit on-chain reference/index design (or a separately verifiable public index) before the UI should claim those workflows are complete. ZK anonymity remains unavailable until a real proof verifier is deployed and audited.
