# Progress

A fresh session can continue with: "read docs/progress.md and continue".
Branch: `claude/admiring-heisenberg-dhraiy`. Build order and rules: `CLAUDE.md`.
Decisions (user's and Claude's defaults): `docs/decisions.md`.

## Status (10.11.2026)

| Milestone | Status |
|---|---|
| M0 Stack + skeleton + deploy | Done. Stack recorded in `docs/decisions.md` and `README.md`. Deployed 10.11.2026 to **https://debatable.nikiash704.workers.dev** (stage 1). |
| M1 Design foundation | Done. Tokens in `src/styles/tokens.css` (from the cached Figma exports in `docs/design-ref/`); top bar, stage stepper, lane, argument card (ours / neutral / red), chip, thesis group; `/dev/gallery` mirrors Figma frame 3:2. |
| M2 Feature 01 | Done. No entry screen, 5-character permanent codes reserved on the server, last round reopens, "Have a code?", recent list, invite banner with link + QR, non-blocking Round setup, live Yjs sync over a Durable Object per room, presence (names/colours, partner highlight), IndexedDB offline copy, server persistence. |
| M3 Feature 02, stage 1 | Done. APDA config + pure engine with unit tests; board UI with speech mode, counter, hotkeys, Cmd/Ctrl+K palette, hotkey tooltips, mouse + keyboard + touch. |
| M4 Verify and ship | Done. Tests green; deployed (two-device e2e test also passes against the deployed URL). |

## Tests (all passing)

- `npm test` — 17 unit tests (Vitest): `src/engine/engine.test.ts` (numbering live/locked, series
  continuation OC5/OA7, carry-over LO → MO, LOR strike clearing + red, POO only in rebuttals,
  Government mirror GA/GC/GR, going back, tags, Tab/Shift+Tab levels, a fake format with other
  speeches) and `src/shared/code.test.ts`.
- `npm run e2e` — 11 Playwright tests against the production build running in workerd
  (`vite preview`):
  - `e2e/flow.spec.ts`: spec 02 acceptance criteria 1–10 on "Ocean vs Space" (Opposition run 1–6,
    criterion 8 mouse + hotkeys + hints, criterion 7 Government, criterion 9 two devices,
    criterion 10 demo format), plus a touch tablet test.
  - `e2e/rooms.spec.ts`: feature 01 (instant room, setup/invite, reopen last round + recent list,
    wrong code, two devices: join by code, presence, same-card co-typing merge, partner highlight,
    shared stage, server persistence; offline edits synced later).
- Fast loop: `npm run dev` then `E2E_BASE_URL=http://localhost:5173 npx playwright test`.

## Deploy

URL: **https://debatable.nikiash704.workers.dev** (Worker `debatable` on the user's Cloudflare account, free plan,
SQLite-backed Durable Objects). Deploy again with `npm run deploy` (= build + `wrangler deploy`); the laptop is
logged in with `wrangler login`. In a cloud session without a login, set `CLOUDFLARE_API_TOKEN`
("Edit Cloudflare Workers" template). Smoke test: `curl <url>/api/health` and
`E2E_BASE_URL=<url> npx playwright test e2e/rooms.spec.ts -g "two devices"`.

## Next

1. Deploy (above) and smoke-test two real devices (laptop + iPad) on the deployed URL.
2. User review of the defaults in `docs/decisions.md` ("Decisions made by Claude Code…").
3. Final participant-name list (open question in spec 01) → `src/config/names.ts`.
4. Feature 02 stage 2 (clash rows + arrows from `respondsTo`, focus/dim, "answered" counters,
   LOR highlights, document view for prep, drag and drop) — the data model already has
   `respondsTo` and `groupId`.
5. Out of scope so far but with room in the layout: speech timer + POI status (config has
   `poiWindow`, `graceSeconds`), "N unanswered" counter, brainstorm rail, hints, Feedback screen.
6. BP / AP configs: add files next to `src/config/formats/apda.ts` (engine unchanged).

## Notes on the specs (not edited)

- Spec 02 «Макет» still says the Figma view lives in file `TJHHaf0ew3Yl9pHjVkJAxQ` and is "not drawn";
  the chosen design is now `AlPJWa4eWeuptbigOL3QS3`, page "✓ D1 · Clean SaaS (chosen)". Worth updating
  the spec (and its copy in the claude.ai Project).
- Spec 02 clears strike-throughs at MO → LOR but keeps speech mode for the speaker; implemented as:
  old strikes hidden, cards said during the rebuttal itself still strike (decision 12).
- Spec 01 "store the room only after the first edit" + "the server checks uniqueness": implemented with
  a 24-hour reservation for never-edited rooms (decision 2).

## Open questions

- Final participant-name list (spec 01).
- Stylus input and AI features (`docs/decisions.md` → Open).
