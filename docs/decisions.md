# Decisions

The app is for practice rounds and training, not for live tournament rounds.

## Decided

1. **Platform**: web app only, for laptops and tablets (decided 10.11.2026).
2. **Hosting**: Cloudflare (decided 10.11.2026).
3. **Who picks the stack**: Claude Code, within the constraints in `CLAUDE.md`
   ("Tech stack"). Record the choice below.
4. **Input for feature 02, stage 1**: mouse and keyboard; every action works with both,
   with visible hotkey hints (see `docs/features/02-struktura-flou.md`).
5. **Format as config**: APDA first; BP and others are added as new config,
   without changing the engine.

## Tech stack

Chosen by Claude Code on 10.11.2026 (M0). Hard constraints from `CLAUDE.md`: Cloudflare,
character-level collaborative text, permanent server-side rooms, offline-first, TypeScript.

| Layer | Choice | Why |
|---|---|---|
| Language | **TypeScript** (strict) everywhere: client, engine, worker, tests | Constraint; one type model shared by engine, sync layer and server. |
| UI | **React 19 + Vite 8** (SPA) | Small, fast dev loop; Vite builds both the client and the Worker through the Cloudflare plugin. No CSS framework: plain CSS with design tokens as CSS variables (`src/styles/tokens.css`), so values match Figma 1:1. |
| Hosting | **One Cloudflare Worker** with **Workers Static Assets** (SPA fallback) | Single deploy unit; `/api/*` and `/parties/*` run in the Worker, everything else is static. Free plan is enough. |
| Rooms / server state | **One Durable Object per room** (SQLite-backed), addressed by the room code | Gives a single, strongly consistent owner per room, holds WebSockets for live sync, and persists the document in its own SQLite storage. Code uniqueness is checked by the room's own object. |
| Real-time sync | **Yjs** CRDT; server class from **`y-partyserver`** (`YServer`, Cloudflare's PartyServer) and its client provider | Yjs `Y.Text` merges concurrent typing character by character (two people can type in one card). `y-partyserver` already implements the Yjs sync + awareness protocol on Durable Objects with load/save hooks, so we only write persistence. |
| Presence | **Yjs awareness** | Partner name/colour, which card the partner is editing (highlight), selection. No extra channel. |
| Offline-first | **`y-indexeddb`** per room + `navigator.storage.persist()` + a small service worker for the app shell | Edits land in IndexedDB first; the provider syncs in the background and on reconnect. The service worker lets the app open without network. |
| Ordering | **`fractional-indexing`** keys for cards and theses | Concurrent inserts from two devices never fight over integer positions. |
| Format | `src/config/formats/*.ts` (APDA now) | Format is config, not code: the engine reads only the config. |
| Fonts | `@fontsource-variable/inter`, `@fontsource/jetbrains-mono` (self-hosted) | Work offline, no third-party font requests. |
| QR | `uqr` | Tiny, dependency-free SVG QR for the invite banner. |
| Tests | **Vitest** (engine unit tests), **Playwright** (end-to-end, two browser contexts) | Engine is pure TS so it is tested without a browser; Playwright drives the real Worker locally (`vite preview` runs it in `workerd`). |

Rejected: Cloudflare Pages + separate Worker (two deploy units for no gain); Automerge (heavier,
weaker text-editing ecosystem than Yjs); a hand-written Yjs WebSocket server (y-partyserver
already does it on Durable Objects); last-write-wins strings (violates the merge constraint);
Tailwind (the Figma export is Tailwind, but tokens as CSS variables keep the DOM readable and
the values identical).

Accounts later: each device has an anonymous `deviceId` (UUID in localStorage) that is sent
to the room on claim/connect; a future account can claim all rooms its devices touched.

## Design vs. spec conflicts (resolved by the user, 10.11.2026)

Specs decide behaviour, the Figma design (D1 · Clean SaaS) decides the look.
- No blocking entry screen: the board opens at once; from the Entry frame only the look is reused
  (invite banner with copy / link / QR, "Have a code?", "Recent on this device", a non-blocking
  "Round setup" panel with motion, side, role and speech times; defaults Opposition, LO, APDA).
- No partner-name field (names and colours are generated); codes are 5 characters, permanent,
  no look-alike characters, no "expires" text.
- Card ids follow spec 02 (OA/OC/OR, GA/GC/GR, PM1/MG1… for the opponent), speech labels come
  from the format config (PMC, LOC, MG, MO, LOR, PMR).
- Colours: own cards "Ours" (green border), opponent cards neutral "Answered"; red only on our
  rebuttal's "new — don't say" cards, always with that label.
- Tag chips use the Response chip look with spec 02's tags; POO uses the Alert tone, only in rebuttals.
- Theses: 2 px left line + "1 · title"; points: the mock's "1a, 1b" rows, collapsed to the first + "•N".
- Lanes 240 px with 40 px gaps, future speeches narrow and dashed, stage stepper kept.
- Out of scope for now (room left in the layout): clash lines, "N unanswered", POI status, timer,
  brainstorm rail, hint tooltip, word suggestions, Feedback screen.

## Decisions made by Claude Code while building v1 (defaults, not yet confirmed by the user)

**Rooms and sync (feature 01)**
1. Code alphabet: `ABCDEFGHJKMNPQRSTUVWXYZ23456789` (no 0/O, 1/I/L), 5 characters, shown without a dash.
2. The device generates the code and reserves it on the server in the background ("claim").
   A claim on a room that was never edited expires after 24 h, so empty visits do not use up codes;
   the first edit stores the room for good. If a code is already taken (very unlikely), the local
   round silently moves to a new code. Live sync starts only after the code is confirmed.
3. A code that does not exist shows "No round with code …". Opening a link offline works from the
   device copy and is checked when the network is back.
4. Yjs layout = room → side → flow with top-level shared types: `room` (stage, side, format,
   prep minutes), `times`, `motion`, and per side `cards:<side>`, `theses:<side>`. Card and thesis
   text and points are `Y.Text`. Switching the side in Round setup shows that side's own flow.
5. Partner names: a temporary list of joke names about politics/debate (no real people,
   `src/config/names.ts`) and 8 colours; if two partners clash, the later one picks a free one.
6. Partner presence: the card the partner types in gets their colour border and name badge
   (the partner's caret inside the text is not drawn).
7. The invite banner shows while no partner is connected and can be hidden; "Have a code?" is
   always in the top bar; "Recent on this device" and "New round" live in the Rounds menu
   (rounds that were never edited are not listed). Round setup opens on a room created on this
   device until it is closed or something is typed.
8. Offline: IndexedDB copy per room, `navigator.storage.persist()`, and a service worker that
   caches the app shell.

**Flow (feature 02, stage 1)**
9. The device's role is stored per room on the device; speech mode turns on by itself when that
   role is giving our current speech. Speech-mode switch (M / button) lasts until the stage changes.
10. Only our cards can be marked said (`saidIn` = current speech). Outside speech mode:
    Cmd/Ctrl+Enter or the ✓ tool.
11. The "said X / Y" counter shows on our column while its speech is being given and counts every
    card in that column (carried ones included).
12. Strike-throughs disappear from the first rebuttal on (data kept), except cards said during the
    rebuttal that is being given, so the LOR speaker can still strike OR cards.
13. Red "new — don't say": during our rebuttal, our unsaid cards from constructive columns.
14. Stage changes are reversible: going back returns carried cards and unlocks numbers; jumping
    several stages runs the steps one by one.
15. A card added to a locked column (late flowing) gets the next free number and is locked at once.
16. Future columns are narrow and closed for new cards; "+ Add …" buttons show on live columns,
    the in-between "+" and the card toolbar work on locked columns too.
17. Empty theses show only in our live columns; elsewhere a thesis shows where it has cards.
    Deleting a thesis moves its cards to the previous thesis.
18. Tags can be put on any card; one tag per type; Same as / Contradicts store the card id and show
    its current number; picking the same card again removes the tag; deleting a card removes
    references to it. POO is offered on any card while a rebuttal is being given.
19. Card text is shown in the mock's title style (13/18 Semi Bold); there is no separate body
    (the data model has text + points). "•N" = total number of points, shown from 2 points on.
20. Keys: Enter on a selected item edits it; while typing Enter adds the next card (next point in a
    point, first card in a thesis title); A adds a card below the selection; Backspace on an empty
    item deletes it; Del deletes the selection; E shows all points; [ / ] previous / next stage;
    M speech mode; ↑↓←→ move; Space in speech mode = said + next card; Cmd/Ctrl+Z / Shift+Z undo /
    redo (each command is one undo step, typing is grouped per editing session).
21. Tab / Shift+Tab: card → last point of the card above (its own points follow); point → card right
    after its card (later points move with it); card → new thesis after the current one (later cards
    of that thesis and the card's points move into it); thesis → card at the end of the previous
    thesis (its cards follow).
22. A click on an already selected card edits it (handy on touch); double-click also edits. In
    speech mode a tap toggles said and a double tap edits.
23. A hidden demo format (`demo-mini`) is registered only to show criterion 10 in the UI.
24. UI language: English (as in the design). The Figma "End round" button is replaced by the Rounds
    menu (Feedback is out of scope).

**Tooling**
25. TypeScript 6.0 (not the 7.0 native port) for tool compatibility; `.npmrc` sets
    `legacy-peer-deps` because `y-partyserver` pins an older `@cloudflare/workers-types` peer.
26. Deploy was not attempted with `wrangler deploy --temporary`: it accepts Cloudflare's terms of
    service on the user's behalf and creates a throwaway account.

## Open

1. **Stylus / handwriting input**: not in stage 1; decide later.
2. **AI features**: which "smart" assists are in v1.
3. **Participant name list** (feature 01): use a temporary placeholder list in a
   separate config file until the user picks the final one.
