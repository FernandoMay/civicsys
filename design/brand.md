# CivicSys — Brand Board

## 1. Identity

**Name**: CivicSys  
**Full name**: CivicSys (Civic System)  
**Tagline**: "Civic decisions. Verifiable by design."  
**Principle**: "Evidence before conclusions."  
**Tone**: Institutional, precise, transparent. Editorial with technical credibility.

### Mission statement
Infrastructure for verifiable civic participation, where evidence anchors every claim. The identity reflects civic duty, architectural precision, and cryptographic verifiability.

## 2. Logo & Symbol

### Symbol
The CivicSys symbol is an open geometric 'C' formed by precise architectural modular brackets enclosing a central verification node point. Clean, hairline precision, civic green and ink, symbolizing an open civic system holding verifiable evidence.

- **Primary**: Symbol + wordmark together
- **Secondary**: Symbol only (square, app icon contexts)
- **Reverse**: Symbol on `Ink #111315`
- **Solid**: Solid symbol on light backgrounds
- **Minimum size**: 16px (symbol only), 24px (with wordmark)

### Wordmark
"CivicSys" set in **Public Sans** (600/semibold), tracking slightly negative. "Ultimate Registry" or secondary descriptor uses **JetBrains Mono** (500) uppercase, tight tracking for technical labeling.

- **Primary wordmark**: CivicSys (Public Sans, 600)
- **Technical descriptor**: Uppercase, monospace, spaced

### Favicon
Use the symbol only, simplified to ensure legibility at 16x16. Maintain clear contrast on both light and dark.

### Logo usage rules
- **Do**: Maintain generous clear space around logo (equal to symbol width)
- **Do**: Use on Paper/Ink or solid Civic backgrounds with proper contrast
- **Don't**: Distort, skew, or apply perspective
- **Don't**: Place on busy imagery without a solid backdrop
- **Don't**: Recolor the symbol arbitrarily (use approved variants)
- **Don't**: Apply drop shadows, glows, or decorative effects that obscure precision

## 3. Color palette

Core brand colors as specified:

| Name | Hex | Usage |
|---|---|---|
| **Paper** | `#F7F7F3` | Primary background. Warm, neutral, paper-like for readability. |
| **Ink** | `#111315` | Primary text, high-contrast surfaces. |
| **Civic** | `#176B55` | Primary brand color. Represents trust, civic infrastructure, verification. |
| **Signal** | `#E8A83E` | Accent, attention, warnings, deliberation states. |

### Extended Material 3-inspired palette
For UI components, we extend the core palette to provide full surface hierarchy while staying true to CivicSys' grounded tone:

| Token | Hex | Role |
|---|---|---|
| `background` / `surface` | `#FBF9F2` | Base app background |
| `surface-container-lowest` | `#FFFFFF` | Highest elevation content (cards, modals) |
| `surface-container-low` | `#F5F4EC` | Subtle containers |
| `surface-container` | `#F0EEE6` | Standard containers |
| `surface-container-high` | `#EAE8E1` | Elevated containers |
| `surface-container-highest` | `#E4E3DB` | Highest surface tier |
| `on-surface` | `#1B1C18` | Primary text |
| `on-surface-variant` | `#3F4944` | Secondary text |
| `outline` | `#6F7974` | Dividers, borders |
| `outline-variant` | `#BEC9C3` | Subtle dividers |
| `primary` | `#00513F` | Interactive elements (darker for affordance) |
| `primary-container` | `#176B55` | Filled containers |
| `on-primary` | `#FFFFFF` | Text on primary |
| `on-primary-container` | `#9BE9CD` | Text on primary containers |
| `inverse-surface` | `#30312C` | Inverted surfaces (hero overlays) |
| `inverse-on-surface` | `#F2F1E9` | Text on inverted surfaces |
| `error` | `#BA1A1A` | Failure states (verification) |
| `error-container` | `#FFDBD6` | Error containers |
| `on-error` | `#FFFFFF` | Text on error |
| `tertiary`/`tertiary-container` | `#624000`/`#815600` | Deliberation, Hermes/analysis |

## 4. Typography

### Typefaces

- **Display & Body**: [Public Sans](https://fonts.google.com/specimen/Public+Sans) — geometric, highly legible, institutional without being cold. Used for headlines, body, labels, UI.
- **Monospace/Technical**: [JetBrains Mono](https://fonts.google.com/specimen/JetBrains+Mono) — precise, technical. Used for hashes, addresses, ledger numbers, code, technical labels, state chips.

### Type scale

| Token | Size/Line | Weight | Tracking | Usage |
|---|---|---|---|---|
| `headline-xl` | 40/48 | 600 | -2% | Hero titles (desktop) |
| `headline-xl-mobile` | 30/38 | 600 | -1.5% | Hero titles (mobile) |
| `headline-lg` | 28/36 | 600 | -1.5% | Section titles |
| `headline-md` | 20/28 | 600 | -1% | Subsections, card titles |
| `body-lg` | 17/26 | 400 | -0.5% | Lead text, introductions |
| `body-md` | 15/22 | 400 | 0 | Body text (default) |
| `body-sm` | 13/18 | 400 | 0 | Supporting text, metadata |
| `label-md` | 12/16 | 600 | +6% | Labels, badges, chips (uppercase recommended) |
| `code-md` | 13/18 | 400 | -1% | Technical values, hashes |
| `code-sm` | 11/14 | 500 | +2% | Micro technical labels |

### Typographic principles
- Prioritize readability and clarity over decoration
- Use sentence case for body; uppercase with tracking for technical/label elements
- Maintain generous line height for readability
- Preserve precision for numeric/hex values (monospace)

## 5. Iconography

**Style**: [Material Symbols](https://fonts.google.com/icons) (outlined/variable) — clean, geometric, systematic.

**Guidelines**:
- Use `opsz,wght,FILL,GRAD` variable font for flexibility
- Default weight: 400-500 depending on context
- Optical size adjusted to text size (16-24px for UI)
- Prefer outlined style for most UI; use filled only for semantic state indicators where clarity is critical
- Maintain consistent stroke/geometry; avoid decorative icons

**Semantic icon mapping (verification states)**:
- `VERIFIED` → `verified`, `check_circle` (filled when emphasizing state)
- `UNKNOWN` → `help`, `help_outline` (outlined)
- `FAILED`/`MISMATCH` → `cancel`, `error` (filled for emphasis)
- `IN DISPUTA`/`warning` → `warning` (outlined/filled as needed)
- Evidence → `fact_check`, `verified_user`
- Ledger/chain → `dataset`, `policy`, `shield`

## 6. Spacing, radius, elevation

### Spacing scale (4pt base)
| Token | Value | Usage |
|---|---|---|
| `space-xs` | 4px (0.25rem) | Tight gaps, icon-text |
| `space-sm` | 8px (0.5rem) | Internal padding, gaps |
| `space-md` | 16px (1rem) | Default spacing |
| `space-lg` | 24px (1.5rem) | Section spacing |
| `space-xl` | 40px (2.5rem) | Major sections |
| `gutter` | 24px (1.5rem) | Grid gutters |
| `gutter-sm` | 16px (1rem) | Mobile gutters |
| `margin` | 48px (3rem) | Page margins (desktop) |
| `margin-sm` | 20px (1.25rem) | Page margins (mobile) |

### Border radius
| Token | Value | Usage |
|---|---|---|
| `default` | 4px (0.25rem) | Inputs, chips, small elements |
| `lg` | 8px (0.5rem) | Cards, panels |
| `xl` | 12px (0.75rem) | Modals, prominent containers |
| `full` | 9999px | Pills, badges |

### Elevation
Subtly use elevation to create hierarchy without breaking the grounded, editorial feel. Prefer borders over heavy shadows.

| Level | Shadow | Usage |
|---|---|---|
| `level0` | none | Flat surfaces |
| `level1` | 1px blur, low opacity | Cards, buttons (rest) |
| `level2` | 2px blur | Elevated cards, dropdowns |
| `level3` | 4px blur | Modals, overlays |

## 7. Verification states (critical)

**Non-negotiable**: `VERIFIED`, `UNKNOWN`, `FAILED` (and `MISMATCH`) must represent results derived from **real evidence/verifier output**. They are semantic states, never decorative labels.

| State | Visual treatment | Meaning (must match SDK verifier) |
|---|---|---|
| `VERIFIED` | Primary green (`#176B55` bg, white text) with check. Use chip-verified style. | All deterministic checks pass; verdict = `verified`. Cryptographically proven against on-chain state. |
| `UNKNOWN` | Signal/warning (`#E8A83E` bg/border) with question/help. | Cannot be proven from chain state now — no default/guess. Includes missing tally, unknown id, zk modes without verifier, RPC failures. |
| `FAILED` / `MISMATCH` | Error (`#BA1A1A`) with cancel/x. | At least one deterministic check demonstrably fails (tampering/corruption). verdict = `mismatch`. |
| `EN DISPUTA` | Tertiary amber/brown treatment | Factual objection presented; enters public deliberation (transitional state). |

**Rule**: UI badges must only echo the computed verdict from `@civicsys/sdk` verifier. Never invent, never decorate independently.

## 8. Graphic language

- **Architecture over decoration**: Modular, grid-based, precise alignments
- **Editorial + technical**: Generous whitespace, clear hierarchy, typographic rhythm
- **Verifiable by design**: Subtly emphasize structure (borders, grids) to reflect auditability
- **Grounded**: Warm paper base, high contrast ink, restrained use of color
- **Monospaced for truth**: Hashes, addresses, ledgers always in JetBrains Mono to signal "machine-verifiable"

## 9. Motion & interaction
- Subtle, functional transitions (150-300ms). No decorative animations.
- Respect `prefers-reduced-motion`.
- Focus states: visible, high-contrast (use primary/outline).
- Hover states: subtle background shifts, no color jumps that reduce clarity.

## 10. Implementation notes
- CSS custom properties for all tokens (light theme primary; dark theme can be added later if needed, but current product reads as light editorial)
- Tailwind config should map to these tokens (as shown in the reference)
- Preserve fail-closed semantics in all stateful UI: unknown states must be visibly distinct and unambiguous
- Never replace computed verification states with static labels