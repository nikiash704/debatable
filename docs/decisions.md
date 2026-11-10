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

_To be filled in by Claude Code: chosen libraries and services, and why._

## Open

1. **Stylus / handwriting input**: not in stage 1; decide later.
2. **AI features**: which "smart" assists are in v1.
3. **Participant name list** (feature 01): use a temporary placeholder list in a
   separate config file until the user picks the final one.
