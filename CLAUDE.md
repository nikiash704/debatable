# Debatable: project context

Smart note-taking ("flowing") app for parliamentary debate tournaments.

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
  - No internet or generative AI during prep or the round. Core flowing must work
    fully offline with AI switched off; AI features are for post-round review and
    practice only, never live in a tournament round.
- AP: Government (PM, DPM, Gov Whip) vs Opposition (LO, DLO, Opp Whip),
  then Opp reply, then Gov reply. Reply speeches are given by the 1st or 2nd speaker.
- BP: Opening Government (PM, DPM), Opening Opposition (LO, DLO),
  Closing Government (Member, Gov Whip), Closing Opposition (Member, Opp Whip).
- POIs (Points of Information) are allowed outside protected time
  (first and last minute of substantive speeches; never in AP reply speeches).
- Speech times vary by tournament, so make them configurable, never hard-coded.

## Workflow
- Development branch: `claude/admiring-heisenberg-dhraiy`.
- Designs live in Figma file `TJHHaf0ew3Yl9pHjVkJAxQ`.
