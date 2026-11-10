# Design direction: Clean SaaS (chosen)

**Decision (2026-11-10):** the app uses **Direction 1 · Clean SaaS** from the design exploration.

- Figma file: [Debate Flow — Design Exploration](https://www.figma.com/design/AlPJWa4eWeuptbigOL3QS3), page **D1 · Clean SaaS**
- Frames: `D1 / 01 Entry`, `D1 / 02 Flow`, `D1 / 03 Feedback`
- Components: `D1 / Argument card`, `D1 / Response chip`, `D1 / Clash arrow` (in `D1 / Components`)
- The other four directions (dark war room, infinite canvas, academic editorial, playful) stay in the
  file for reference only.

## Look and feel

Light, Linear/Notion-like: neutral grays, precise typography, thin straight connectors.
Status lives in a thin border tint, so the board stays calm until something turns red.

## Color logic (same meaning on every screen)

| Meaning | Use | Values |
|---|---|---|
| **Green**: our strong / standing arguments | card border, ID badge | border `#BBE7CB`, badge `#E8F7EE` / `#15803D`, lines `#16A34A` |
| **Red**: opponent arguments we have not answered | card fill + border, counter | fill `#FFF6F6`, border `#F3B4B4`, badge `#FDE2E2` / `#C62828`, counter `#DC2626` |
| **Neutral**: answered / neutralized | card fill + border | fill `#FAFAFA`, border `#E6E6EA`, badge `#EFEFF2` / `#71717A` |
| POO / alert | response chip | `#FFF7ED` / `#FDBA74` / `#C2410C` |
| POI | marker tag | `#EEF2FF` / `#4338CA` |

Base palette: page `#F7F7F8`, surface `#FFFFFF`, border `#E6E6EA`, text `#18181B`,
secondary text `#52525B` / `#71717A`, muted `#A1A1AA`.

## Typography

- **Inter** for UI and card text (13 px titles in Semi Bold, 12 px body).
- **JetBrains Mono** for IDs (G1, O2, M3), timestamps, the round code and the timer.

## Layout rules

- Top bar: brand, motion, side/role/partner, round code with copy, end-round button.
- Stage bar: speech stepper (PMC → LOC → MGC → MOC → LOR → PMR), POI window status,
  speech timer with protected first/last minute shaded, and the "N unanswered" counter.
- Board: one lane per speech (240 px wide, 40 px gaps for clash lines); future speeches are
  narrow and dashed. Brainstorm is a collapsed left rail.
- Clash lines are straight, thin, and run from the response (dot) to the argument it
  attacks (arrowhead). Line color follows the source card's status.
- Corner radius 6–8 px on cards and controls, 12 px on panels; shadows are very subtle.

## Screens

1. **Entry**: "Start new round" generates a code (e.g. `K7F-29Q`) shown in large tiles with a
   copy button; "Resume with code" input; setup (motion, side, role, partner, editable speech times).
2. **Flow**: the live board described above, plus quick-response chips, a hint tooltip and
   word-suggestion popover on the card being typed.
3. **Feedback**: summary (dropped, strongest clash, weakest link), style tips quoting the
   user's phrasing with a rewrite, per-speech table, round map, and 3 "next round" actions.
