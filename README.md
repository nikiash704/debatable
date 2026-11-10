# Debatable

A smart note-taking (flowing) app for competitive parliamentary debating,
built for practice rounds and training.

## Supported formats

| Format | Teams | Speakers | Speeches |
|---|---|---|---|
| **American Parliamentary (APDA)** | Government vs Opposition | 2 + 2 | 6 (4 constructives + 2 rebuttals) |
| **Asian Parliamentary (AP)** | Government vs Opposition | 3 + 3, plus reply speeches | 8 (6 substantive + 2 reply) |
| **British Parliamentary (BP)** | OG, OO, CG, CO | 2 per team | 8 |

## Planned features (draft)

- Per-speech flow sheets laid out by format (columns per speech / bench)
- Argument tracking: link rebuttals, POIs, and extensions to the arguments they answer
- Speech timers with protected-time signals and POI windows
- Motion + infoslide capture, prep-time timer, case-building notes
- Round history across a tournament (motion, side, result, feedback)
- Adjudicator mode: clash summary, speaker scores, ranking/decision notes
- "Smart" assists: auto-structuring rough notes, clash detection, post-round summaries

## Connected tools

| Tool | What it's for | Link |
|---|---|---|
| GitHub | Source code | https://github.com/nikiash704/debatable |
| Figma | UI designs (chosen: D1 · Clean SaaS) | https://www.figma.com/design/AlPJWa4eWeuptbigOL3QS3 |
| Google Drive | Motions, research, reference material | (connected to Claude) |

## Local setup (your laptop)

1. **GitHub Desktop**: *File → Clone repository → nikiash704/debatable*.
2. **VS Code**: in GitHub Desktop, *Repository → Open in Visual Studio Code*.
   Install the recommended extensions when VS Code prompts you
   (listed in `.vscode/extensions.json`).
3. **Claude Code on your laptop** (optional): run `claude` in the repo
   folder, or `claude remote-control` to drive it from the Claude app.

## Feature specs

See `docs/features/` (indexed in `CLAUDE.md`).

## Tech stack

Full reasoning in `docs/decisions.md` ("Tech stack").

- **TypeScript** everywhere; **React 19 + Vite 8** single-page app, plain CSS with design tokens.
- **Cloudflare Worker** (static assets + API) with **one Durable Object per room** (SQLite storage).
- **Yjs** CRDT for live collaboration (`Y.Text` per card, so two people can type in one card),
  synced through **`y-partyserver`**; **`y-indexeddb`** keeps a local copy for offline-first use.
- **Vitest** for the flow engine, **Playwright** for end-to-end tests.

## Project layout

| Path | What |
|---|---|
| `src/config/` | Format configs (APDA; a hidden demo format), participant names |
| `src/engine/` | Pure TypeScript flow engine: numbering, stages, carry-over, commands (unit-tested) |
| `src/sync/` | Yjs document schema, room session (IndexedDB + live sync + presence), device storage |
| `src/ui/` | React UI: board, top bar, stage bar, setup panel, palette; `components/` = design system pieces |
| `worker/` | Cloudflare Worker + `Room` Durable Object (Yjs server, persistence, code reservation) |
| `e2e/` | Playwright tests (spec 02 acceptance criteria, feature 01, touch) |
| `docs/` | Specs, decisions, design notes, Figma reference cache, progress |

## Develop

```bash
npm install
npm run dev        # app + Worker + Durable Objects locally (workerd) on http://localhost:5173
npm test           # engine unit tests
npm run e2e        # Playwright end-to-end tests (builds, then runs the Worker locally)
npm run deploy     # build and deploy to Cloudflare (needs `wrangler login` or CLOUDFLARE_API_TOKEN)
```
