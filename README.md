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
| Figma | UI designs | https://www.figma.com/design/TJHHaf0ew3Yl9pHjVkJAxQ |
| Google Drive | Motions, research, reference material | (connected to Claude) |

## Local setup (your laptop)

1. **GitHub Desktop**: *File → Clone repository → nikiash704/debatable*.
2. **VS Code**: in GitHub Desktop, *Repository → Open in Visual Studio Code*.
   Install the recommended extensions when VS Code prompts you
   (listed in `.vscode/extensions.json`).
3. **Claude Code on your laptop** (optional): run `claude` in the repo
   folder, or `claude remote-control` to drive it from the Claude app.

## Tech stack

Not yet chosen. See `docs/decisions.md`.
