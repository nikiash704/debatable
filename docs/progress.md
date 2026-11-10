# Progress

A fresh session can continue with: "read docs/progress.md and continue".
Branch: `claude/admiring-heisenberg-dhraiy`. Build order and rules: `CLAUDE.md`.
Decisions (user's and Claude's defaults): `docs/decisions.md`.

Live app: **https://debatable.nikiash704.workers.dev**

## Status (10.11.2026)

| Milestone | Status |
|---|---|
| Stack + skeleton + deploy | Done. Deployed with `wrangler login` on the user's laptop. |
| Design foundation (D1 · Clean SaaS) | Done (tokens, components, `/dev/gallery`). |
| Feature 01 (rooms, codes, sync, offline, persistence) | Done. |
| Feature 02, stage 1 | Done; 10/10 criteria. |
| **Feature 02, stage 2 (clash)** | **Done; 13/13 criteria of the stage-2 brief** (see below). Defaults await the user's review: `docs/decisions.md` → "Stage 2 defaults". |
| Feature 02, stage 3 | Not started. |

### Stage 2 milestones
- **M0 Deploy** — stage 1 deployed 10.11.2026, then stage 2 (same URL).
- **M1 Engine** — `src/engine/rows.ts` (`layoutRows`, `numberingOrder`), `clash.ts` (links, Answer target
  column, answered / unanswerable status, lane counters, unanswered list), `timer.ts` (prep timer, pure),
  `moves.ts` (drag / keyboard move slots and ops), board view-model (statuses, links, rebuttal "said in"),
  `respondsTo` as a `Y.Array` (`card.link` / `card.unlink` ops). Unit tests in `src/engine/stage2.test.ts`.
- **M2 Board** — CSS grid of lanes (subgrids) and shared rows, SVG clash lines (`src/ui/Arrows.tsx`), focus
  ring + dimmed lanes, Answer (R) / Link pick mode (L) / unlink ×, lane counters, "N unanswered" pill,
  legend, rebuttal highlights, palette entries with hotkeys.
- **M3 Doc view + prep timer** — `src/ui/DocView.tsx`, `src/ui/PrepTimer.tsx`; Board / Doc switch (D).
- **M4 Drag and drop** — `src/ui/drag.ts` (mouse, touch long press, Alt+↑/↓), FLIP in `Board.tsx`.
- **M5 Verify and ship** — all tests green on the production build; deployed.

## Tests (all passing)

- `npm test` — 43 unit tests (Vitest): `src/engine/engine.test.ts` (stage 1, 15), `src/engine/stage2.test.ts`
  (26: links, Answer column, rows — chains, two targets, carried cards, stacks, gaps, determinism —, live
  renumbering vs locked numbers, OC5/OC6 order, statuses and counters, LOR highlights, Government mirror,
  demo format, prep timer, drag moves, Yjs merge of concurrent links and old plain arrays),
  `src/shared/code.test.ts` (2).
- `npm run e2e` — 18 Playwright tests against the production build in workerd (+1 skipped dev utility):
  - `e2e/clash.spec.ts` (stage 2): criterion 1 (Doc prep, partner on the Board), 2 (prep timer with
    Playwright's clock on two devices), 3–8 + 11 (one two-device run: Answer, Link, unanswered + pill,
    two targets + × unlink, focus on one device only, MG / MO incl. the straight MO → PM4 arrow and counters,
    LOR highlights, PMR never unanswered), 9 (drag: step aside + renumber on drop, Alt+↑/↓, points, theses,
    linked answer snaps back, locked column, sync to the partner), 9 touch (long press via CDP touch events;
    a swipe still scrolls), 10 (Government mirror), 12 (demo format). Criterion 13 = the suites below.
  - `e2e/flow.spec.ts` (stage 1, criteria 1–10 + touch) and `e2e/rooms.spec.ts` (feature 01): unchanged
    except as listed under "Tests changed for stage 2".
  - `e2e/dev-shots.spec.ts`: skipped unless `SHOTS=<dir>`; renders the board at 1440×900 for comparing with
    `docs/design-ref/flow-3-2.png`.
- Fast loop: `npm run dev` then `E2E_BASE_URL=http://localhost:5173 npx playwright test`.

### Tests changed for stage 2 (and why)
- `e2e/helpers.ts`: `openNewRoom` / `openRoom` take `view` (default `"board"`) and switch to the Board,
  because a round in Prep now opens in the Doc view. New helper `showView`.
- `e2e/rooms.spec.ts` "two devices": one added line `showView(b.page, "board")` after B joins by code
  (B opens the round in Prep → Doc view).
- `e2e/flow.spec.ts` "touch": one added tap on the Board switch after opening a new round (same reason).
- No expectation about lane order, numbers or colours had to change: rounds without links lay out exactly
  as in stage 1, and "Unanswered" red uses its own class (`card--unanswered`), so stage 1's
  `.card--red` / `data-red` checks still mean "new — don't say".

## Deploy

`npm run deploy` (= build + `wrangler deploy`), Worker `debatable` on the user's Cloudflare account (free plan,
SQLite-backed Durable Objects). The laptop is logged in (`wrangler login`); a cloud session needs
`CLOUDFLARE_API_TOKEN` ("Edit Cloudflare Workers" template). Smoke test: `curl <url>/api/health` and
`E2E_BASE_URL=<url> npx playwright test e2e/rooms.spec.ts -g "two devices"`.

## Next

1. User review of "Stage 2 defaults" in `docs/decisions.md`, especially: the numbering rule (13), linked own
   arguments moving rows (9), dimming only when the card has links (18), the Doc view's content (23).
2. Smoke-test two real devices (laptop + iPad) on the deployed URL: touch drag, Doc view typing, prep timer.
3. Feature 02 stage 3: grouping the opponent's arguments (`groupId`), "dropped by Gov" (our said argument with
   no incoming answer, hint for LOR). Room is left: `groupId` is stored, rows are per lane, the stage bar has
   space for more pills.
4. Later: speech timer + POI status (config has `poiWindow`, `graceSeconds`; the prep timer's slot is the
   speech timer's), brainstorm rail, hint tooltip, word suggestions, Feedback screen, AI features.
5. Mouse drag inside the Doc view (keyboard Alt+↑/↓ works there now).
6. BP / AP configs: add files next to `src/config/formats/apda.ts` (engine unchanged).
7. Final participant-name list (open question in spec 01) → `src/config/names.ts`.

## Notes on the specs

- Spec 02 «Макет» now names the chosen design (`AlPJWa4eWeuptbigOL3QS3`, page "✓ D1 · Clean SaaS
  (chosen)"), replacing the old `TJHHaf0ew3Yl9pHjVkJAxQ` reference. **The copy in the claude.ai Project needs
  the same edit.**
- Stage-2 brief vs spec: "live columns are numbered top to bottom" conflicts with criterion 7 and the spec's
  MO order (MG answers, then PM leftovers); built as the spec / criterion say (decision 13 of stage 2).
- Spec 02 stage 1 clears strike-throughs at MO → LOR but keeps speech mode for the speaker; implemented as:
  old strikes hidden, cards said during the rebuttal itself still strike (stage-1 decision 12).
- Spec 01 "store the room only after the first edit" + "the server checks uniqueness": implemented with a
  24-hour reservation for never-edited rooms (stage-1 decision 2).

## Open questions

- Final participant-name list (spec 01).
- Stylus input and AI features (`docs/decisions.md` → Open).
- Should prep end when only one device is online and its clock is off? (Clock skew is not corrected.)
