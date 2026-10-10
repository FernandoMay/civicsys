# Brújula Cívica Design System

## Brand foundation

Brújula Cívica design system based on "Civic decisions. Verifiable by design." with the core principle "Evidence before conclusions."

## Core colors
- **Paper** `#F7F7F3` — Background
- **Ink** `#111315` — Text
- **Civic** `#176B55` — Primary brand
- **Signal** `#E8A83E` — Accent/warning

## Verification states (evidence-derived)
- `VERIFIED` — All deterministic checks pass
- `UNKNOWN` — Cannot be proven from chain state (no default, no guess)  
- `FAILED`/`MISMATCH` — Deterministic checks demonstrably fail

**Non-negotiable:** These states must come from real verifier output, never decorative labels.

## Files
- [brand.md](./brand.md) — Complete brand board
- [tokens.json](./tokens.json) — Design tokens (JSON)
- [tokens.css](./tokens.css) — CSS custom properties
- [brand-preview.html](./brand-preview.html) — Visual brand board preview
- [assets/logo-symbol.svg](./assets/logo-symbol.svg) — Logo symbol

## Usage in dashboard
The dashboard currently uses its own styles; when applying the new system, preserve all on-chain reads and fail-closed behavior. Verification states must remain computed via `@brugulacivica/sdk` verifier.