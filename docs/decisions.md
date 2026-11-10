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
  rebuttal's "new — don't say" cards, always with that label. (Stage 2 adds the design's red
  "Unanswered" look for opponent cards nobody answered yet, as the stage-2 brief asks.)
- Tag chips use the Response chip look with spec 02's tags; POO uses the Alert tone, only in rebuttals.
- Theses: 2 px left line + "1 · title"; points: the mock's "1a, 1b" rows, collapsed to the first + "•N".
- Lanes 240 px with 40 px gaps, future speeches narrow and dashed, stage stepper kept.
- Out of scope for now (room left in the layout): clash lines, "N unanswered", POI status, timer,
  brainstorm rail, hint tooltip, word suggestions, Feedback screen. (Clash lines, "N unanswered" and a prep
  timer in the timer's slot were built in stage 2.)

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

## Stage 2 defaults (Claude, not yet confirmed by the user)

Feature 02 stage 2 ("clash") was built from an agreed plan, not a detailed spec. The rules in the stage-2
brief were built as written; everything below is either one of those rules made concrete or a choice
Claude made where the brief left room. All of it can change.

**Answer links (`respondsTo`)**
1. A card may answer cards of the other side whose column comes strictly earlier in the speech order.
   "Column" is the card's current column, so a card carried from LO to MO counts as an MO card (MG cannot
   answer an unsaid, carried LO argument).
2. `respondsTo` is a `Y.Array` per card (ops `card.link` / `card.unlink`), so two devices can link the same
   card at once. Duplicates from concurrent links are dropped on read; the order is Yjs's merge order, the
   same on every device. Stage-1 rooms stored a plain array: it is still read and becomes a `Y.Array` on its
   first link / unlink (two devices doing that first change at the same moment could lose one of them).
3. Answer (R / "↩ Answer" / palette) puts the new card in the earliest live column of the other side after
   the target's column — its clash zone when it has one — at the end of that zone, linked and in typing mode.
   When there is none the button shows just "↩" (disabled) and its tooltip / the palette entry say why
   ("No live Government column after LOC yet (MG, PMR not open)").
4. The card toolbar starts 28 px from the card's left edge (so it never covers the "+" insert target above
   the card); "Link" is hidden on cards that have nothing they could link to and no target yet.
5. Link pick mode (L / "Link" / palette): eligible cards get an indigo ring, ineligible ones fade to 35 %,
   current targets are marked; click / tap / ↑↓←→ + Enter (or Space) toggles a target; Esc, L again, "Done"
   or a click on the empty board ends it. Pick mode, the cursor and the selected arrow are this device only.
6. Unlink: × on a hovered (250 ms grace) or selected arrow (a click / tap on a line selects it; Delete then
   unlinks), the pick mode, or "Unlink X → Y" in the palette. Deleting a card unlinks it everywhere.
7. Enter while typing an answer creates the next answer unlinked in the same zone; it therefore lands with the
   lane's other unlinked answers (its own region, see 10), not directly under the answer.

**Rows (`layoutRows`, engine)**
8. A target is "visible" when it exists, is of the other side and sits in an earlier lane; a card follows the
   first visible target in link order. Lanes strictly decrease along a chain, so there are no cycles.
9. Rule 1 applies to every card, our own arguments under theses too: a linked argument moves into its
   target's row like any answer (the thesis then shows as more than one segment, see 11).
10. Each lane reads top to bottom as: cards in rows started by earlier lanes (answers beside their targets,
    carried cards in their old rows), then its **own region** (rows started by its own cards), which looks and
    works like a stage-1 column: "Responses" / "Arguments" labels, thesis headers, "+" gaps, "+ Add …" and
    "+ Argument / + Thesis". Groups that stage 1 showed empty (live theses, empty flat zones) get a placeholder
    row so their header and add button have a place. A locked LO whose responses all moved to MO shows an
    empty "Responses + Add response" placeholder (late flowing).
11. Thesis segments: a thesis is drawn (line + header) over each run of consecutive cards of that thesis in a
    lane. Normally that is one segment; it can be several, e.g. in MO the carried OA2 (in OA2's LO row) and
    MO's new argument in the same thesis (in MO's own region). Each segment repeats the header.
12. "+" insert gaps exist only between cards of a lane's own region (where a new card really lands there).
13. **Numbering (conflict in the brief):** "live columns are numbered top to bottom" would make the MO answer
    to PM4 (in PM4's row, near the top) OC5, but criterion 7 and the spec («Порядок ответов MO: сначала MG,
    потом оставшееся от PM») want OC5 → MG1, OC6 → PM4. So a lane is numbered: clash zone first (as in stage
    1), grouped by the answered speech in the lane's `defaultTargets` order (MG, then PMC; unlinked last), top
    to bottom inside each group; then the own zone top to bottom. The opponent's lanes are numbered top to
    bottom. Locked numbers never change.
14. Rendering: the board is one CSS grid; each lane is a subgrid column, each layout row has four tracks
    (zone label, thesis header, cards, footer), so a row is as tall as its tallest stack and cards line up
    without measuring. Lanes keep the stage-1 sizes (240 px, 40 px gaps, future lanes 100 px).

**Arrows**
15. One straight line per link from a dot on the answer card's left edge to an arrowhead on the target's right
    edge, both at the height of the card's ID badge; lines are drawn under the cards. Colour = the answer
    card's status: green (ours), red (an unanswered opponent card or our "new — don't say"), grey otherwise.
16. Drawn imperatively in one `requestAnimationFrame` pass after each board change and whenever a
    `ResizeObserver` (grid + every card) fires; positions come from offsets, so scrolling needs no redraw.
    Hovering or selecting a card or a line thickens its lines and outlines both ends (classes only, no
    re-render).
17. The "Responding to PM1, PM2" line sits in the card head (as in the mock's M3) with the target IDs as small
    badges in the target's colour; the title moves to its own line.

**Focus**
18. Focus = the selected (or edited) card's targets and the cards that answer it get a ring; lanes holding none
    of them, nor the selected card, dim to 45 %. When the card has no links nothing dims (otherwise every
    lane would dim with nothing highlighted). Never synced.

**Answered status and counters**
19. Unanswerable = the format has no speech of ours after the card's (current) column. "Unanswered" uses the
    design's red Unanswered look with a class of its own; stage 1's red "new — don't say" keeps its label.
20. Lane counters show on our live columns (not only during the speech), next to "said X / Y" when both show.
    Labels use the opponent label of the speech (PM, MG, LO, SO…). A part is shown only for target speeches
    that have at least one card. "from PM left z" turns red when z > 0.
21. The "N unanswered" pill is hidden at 0; its IDs are in board order; a click opens the Board, selects the
    card and scrolls it to the centre. The palette lists "Go to unanswered …" too.

**Rebuttal highlights**
22. During our rebuttal, our cards said in a constructive get a light green fill (`#F0FDF4`, border `#86D9A6`;
    not in the mock) and a mono meta line "said in LOC" / "said in MO".

**Doc view**
23. The Doc view shows our side's theses, our arguments (own zone, all our columns, column order then
    `order`) and their points. Responses and the opponent's cards stay on the Board; arguments without a
    thesis are listed under "No thesis". Card lines show the board label (OA1…) on the right.
24. Arguments typed in the doc go to our live column with arguments (LO during prep), else the last open one.
25. Enter splits the line at the caret (the rest moves to the new line). Enter on a thesis line makes the next
    thesis (shown after this thesis's arguments); Tab on a new, empty thesis line turns it into an empty
    argument at the end of the thesis above (`indentThesis` gained a `keepEmpty` flag). Points cannot go
    deeper. ↑/↓ leave a line from its first / last visual line.
26. The view (Board / Doc) is remembered per room on each device. A device opening a round in Prep for the
    first time gets the Doc view; entering Prep switches to Doc, leaving it to Board (switching the format
    between two prep stages does not count). The e2e helpers open the Board by default.

**Prep timer**
27. The timer is started by hand (Start / Shift+Space); +1 min (+) and Reset (Shift+R) also have buttons and
    palette entries; hotkeys work during Prep while not typing. Each Start and Reset begins a new run id.
28. "Exactly once": one Yjs transaction checks that the room is still in Prep and that this run has not ended
    prep yet, then marks the run and moves to the first speech. If two devices do it offline at the same
    time they write the same values. A `prepEnded` marker in the room makes every device show the toast once.
29. Undo in the toast goes back to Prep (Doc view); the finished run never fires again, the clock shows 00:00
    until +1 min or Reset. Timer actions and the automatic stage change are not part of Cmd/Ctrl+Z.
30. The countdown is an absolute end time written by the device that pressed Start; clock differences between
    devices are not corrected.

**Drag and drop**
31. No library: own pointer code (`src/ui/drag.ts`). Reason: the landing preview is the engine's own row
    layout (a list-sorting library would fight the rows), and it saves a dependency.
32. While dragging, the board is drawn from the state the drop would give (labels stay real until the drop),
    moved cards and theses slide (FLIP, 170 ms), the dragged card shows as a dashed placeholder where it will
    land, a ghost follows the pointer. Slots are hit-tested against positions taken at drag start.
33. Mouse: press and move 5 px (the hover toolbar strip at the card's top edge is not a handle). Touch: long
    press 380 ms; moving more than 8 px before that is a scroll. Esc cancels. The board auto-scrolls near its
    edges once the pointer has moved.
34. Where things may go: a card stays in its lane and zone; cards that start rows move among the rows that
    start in the same lane (between theses too, empty live theses included); a linked answer only inside its
    row's stack (elsewhere: snap back, toast "Use L to change the target"; Alt+↑/↓ at the stack's edge says the
    same). A point moves inside its card and to other cards of the same lane. Theses reorder by dragging the
    header (thesis order is per side, so every lane follows). Alt+↑/↓ = one slot, also while typing and in the
    Doc view (mouse / touch drag is on the board only).

## Open

1. **Stylus / handwriting input**: not in stage 1; decide later.
2. **AI features**: which "smart" assists are in v1.
3. **Participant name list** (feature 01): use a temporary placeholder list in a
   separate config file until the user picks the final one.
