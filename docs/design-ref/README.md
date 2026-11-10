# Figma reference cache (D1 · Clean SaaS)

Exported once from Figma file `AlPJWa4eWeuptbigOL3QS3` on 10.11.2026, so the app can be compared
with the design without calling the Figma API again (the account's MCP quota is small).

| File | Figma node | What |
|---|---|---|
| `flow-3-2.png` | `3:2` D1 / 02 Flow | Board: top bar `3:3`, stage bar `3:22`, board `3:74` (1024×640 render of a 1440×900 frame) |
| `entry-5-181.png` | `5:181` D1 / 01 Entry | Look for the room code, resume, recent list and round setup |
| `card-2-86.png` | `2:86` D1 / Argument card | Variants Ours, Unanswered, Answered (232 px wide each) |
| `chip-2-10.png` | `2:10` D1 / Response chip | Default, Alert |
| `assets/*.svg` | icons | copy, check, live dot, dot, notes, expand, hint, clash arrow |

The file has **no Figma variables** (`get_variable_defs` returned `{}`); the values below were read
from the generated design code and are mirrored in `src/styles/tokens.css`.

## Values

- Page `#F7F7F8`, surface `#FFFFFF`, border `#E6E6EA`, input border `#D4D4D8`, dashed lane `#E4E4E7`.
- Text `#18181B`, `#3F3F46` (labels), `#52525B`, `#71717A`, muted `#A1A1AA`, faint `#D4D4D8`, empty-lane `#C4C4CC`.
- Subtle fill `#F4F4F5` (pills, finished stages).
- Ours: border `#BBE7CB`, badge `#E8F7EE`/`#15803D`, sub-row `#F4FBF6`, line `#16A34A`, live dot `#22C55E`,
  focus ring `rgba(23,163,74,0.18)` 3 px with 1.5 px `#16A34A` border (card being typed).
- Unanswered / red: fill `#FFF6F6`, border `#F3B4B4`, badge `#FDE2E2`/`#C62828`, sub-row `#FDECEC`;
  counter `#FEF2F2`/`#FECACA`/`#B91C1C`, `#DC2626`.
- Answered / neutral: fill `#FAFAFA`, border `#E6E6EA`, badge `#EFEFF2`/`#71717A`, sub-row `#F3F3F5`,
  title `#52525B`, body `#71717A`.
- Alert chip (POO): `#FFF7ED` / `#FDBA74` / `#C2410C`. POI tag `#EEF2FF` / `#4338CA`.
- Type: Inter (card title 13/18 Semi Bold, body 12/17, chip 11 Medium), JetBrains Mono (IDs 11/16 Medium,
  lane label 12 Bold, meta 10/14).
- Card: padding 10×12, gap 8, radius 8, shadow `0 1px 1px rgba(0,0,0,.04)`; badge padding 2×6 radius 4;
  sub-row padding 4×6 radius 4 gap 6; chip padding 3×8 radius 6.
- Top bar 52 px (padding 0 20, gap 16); stage bar 56 px (gap 20); stage pill padding 5×10 radius 6,
  current = `#18181B` + live dot, done = `#F4F4F5` + check, future = white dashed `#E6E6EA` text `#A1A1AA`.
- Board: lanes 240 px, gap 40, starting 16 px from the left, 14 px from the top; lane header label
  mono 12 Bold + side tag (`Gov` `#F4F4F5`/`#71717A`, `Opp` `#E8F7EE`/`#15803D`) + `LIVE` tag + minutes;
  subtitle 11/14 `#A1A1AA`. Future lanes 100 px, opacity .8, dashed empty box "Not yet spoken".
- Panels: radius 12, shadow `0 8px 24px rgba(23,23,28,.06)`; popovers `0 8px 20px rgba(23,23,28,.1)`;
  tooltip `#18181B`, radius 8, shadow `0 6px 16px rgba(23,23,28,.18)`.
