# Debatable: project context

Smart note-taking ("flowing") app for parliamentary debate practice.

## Domain
- Formats: American Parliamentary (APDA), Asian Parliamentary (AP) and
  British Parliamentary (BP).
- APDA (US college circuit; rules: https://apda.online/about/official-apda-rulebook/):
  2 v 2, Government (PM, MG) vs Opposition (LO, MO). Speech order:
  PMC (PM) 7, LOC (LO) 8, MG 8, MO 8, LOR (LO) 4, PMR (PM) 5 minutes,
  each with a 30-second grace period. MO + LOR run back to back (the "Opp block").
  - POIs only in constructives: PMC from 1:00 to 6:00; LOC, MG, MO from 1:00 to 7:00.
    None in rebuttals. Each POI is at most 15 seconds.
  - Points of Order: raised by the other team during rebuttals (LOR, PMR) against
    new arguments; the clock pauses. Rulings: well taken / not well taken /
    under consideration. The PMR may answer arguments first made in the MO.
  - Prep: 15 minutes. "Cases" tournaments (Gov brings its own case; Opp may make
    a tight call at the very start of the LOC, or spec calls) vs "motions"
    tournaments (motion released; types THBT, THW, THS/THO, THP, THPAW).
- AP: Government (PM, DPM, Gov Whip) vs Opposition (LO, DLO, Opp Whip),
  then Opp reply, then Gov reply. Reply speeches are given by the 1st or 2nd speaker.
- BP: Opening Government (PM, DPM), Opening Opposition (LO, DLO),
  Closing Government (Member, Gov Whip), Closing Opposition (Member, Opp Whip).
- POIs (Points of Information) are allowed outside protected time
  (first and last minute of substantive speeches; never in AP reply speeches).
- Speech times vary by tournament, so make them configurable, never hard-coded.

## Product decisions (fixed)
- Practice/training tool, not for live tournament rounds.
- Web app only, for laptops and tablets.
- Hosting: **Cloudflare** (Workers / Pages and related services).
- The format (APDA now, BP and others later) is **config, not code**: the stage engine,
  cards, numbering and counters read only the format config.
- Data shape from day one: room → side → flow. v1 has one side per room.
- No accounts in v1, but the design must allow adding them later
  (anonymous device ID now → link to an account later, carrying rounds over).

## Feature specs (source of truth for what to build)
Specs are written in Russian. Read the relevant spec in full before coding a feature.
Each spec separates the user's decisions from Claude's unconfirmed suggestions;
the user's decisions are binding, suggestions are not.

| # | Feature | Status | File |
|---|---|---|---|
| 01 | Entry and saving (no login, room codes, live sync, server persistence) | decided for v1 | `docs/features/01-vhod-i-sohranenie.md` |
| 02 | Flow structure (cards, theses, stages, numbering, "said", speech mode) — main feature | **stage 1 approved for coding**; stages 2–3 planned | `docs/features/02-struktura-flou.md` |

These files are copies of the docs in the claude.ai Project "Debatable"
(`claude/features/*.md`). When a spec changes in either place, update the other.

## Build order
1. Stack + project skeleton + a deployed "hello world" on Cloudflare.
2. Feature 01 (rooms, codes, real-time sync, server persistence).
3. Feature 02, stage 1, on top of 01's sync. Done = all 10 acceptance criteria in the
   spec pass on the "Ocean vs Space" scenario.

## Tech stack
Not fixed by the user: **Claude Code chooses it.** Hard constraints:
- deploys to Cloudflare;
- real-time collaborative editing where two people can type in the same card at once
  (character-level merge, so a text CRDT, not last-write-wins on strings);
- rooms persisted on the server, permanent room codes;
- offline-first on the device (save locally, then sync in the background);
- TypeScript.
Record the chosen stack and the reasons in `docs/decisions.md` before writing app code,
and update the "Tech stack" section of `README.md`.

## Design
- Look and feel: `docs/design.md` (direction **D1 · Clean SaaS**, Figma file `AlPJWa4eWeuptbigOL3QS3`,
  page "✓ D1 · Clean SaaS (chosen)"; pages D2–D5 are rejected explorations).
- Cached Figma exports (screenshots, icons, extracted values) live in `docs/design-ref/`,
  so the Figma API does not need to be called again; tokens are in `src/styles/tokens.css`.
- Specs decide behaviour, the design decides the look.

## Workflow
- Development branch: `claude/admiring-heisenberg-dhraiy`.
- Commit after each working step with a clear message, so any step can be rolled back.
- Designs: see "Design" above. Progress and next steps: `docs/progress.md`.
- Keep `docs/decisions.md` current when a decision is made.
