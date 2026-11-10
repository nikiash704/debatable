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

## Open

1. **Stylus / handwriting input**: not in stage 1; decide later.
2. **AI features**: which "smart" assists are in v1.
3. **Participant name list** (feature 01): use a temporary placeholder list in a
   separate config file until the user picks the final one.
