# Progress

A fresh session can continue with: "read docs/progress.md and continue".
Branch: `claude/admiring-heisenberg-dhraiy`. Build order and rules: `CLAUDE.md`.

## Status by milestone

| Milestone | Status |
|---|---|
| M0 Stack + skeleton + deploy | Stack chosen, skeleton builds and runs locally (`vite preview` runs the Worker + Durable Object in workerd). **Deploy blocked: no Cloudflare login in the cloud session** (see "Deploy"). |
| M1 Design foundation | not started |
| M2 Feature 01 | not started |
| M3 Feature 02, stage 1 | not started |
| M4 Verify and ship | not started |

## Deploy

`npx wrangler deploy` needs a Cloudflare account. In the cloud session there is no login and no
`CLOUDFLARE_API_TOKEN`. To deploy, either:
- on a laptop: `npm install && npx wrangler login && npm run deploy`, or
- add a Cloudflare API token ("Edit Cloudflare Workers" template) to the cloud environment
  and run `npm run deploy` (wrangler reads `CLOUDFLARE_API_TOKEN`).
The first deploy prints the `*.workers.dev` URL. Free plan is enough (SQLite Durable Objects).
Wrangler also offers `wrangler deploy --temporary` (a throwaway preview account); it accepts
Cloudflare's terms of service on your behalf, so it was not used.

## Next

See the milestone table.

## Open questions

None yet.
