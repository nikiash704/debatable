# Plan: AI sentence suggestions (gray "ghost text") in every round text field

Status: **plan, not started.** Written 17.11.2026. Nothing in the app has changed yet.

## 1. What the user asked for (binding)

- In **every text field of a round**, show an AI suggestion as **gray text** after the caret that
  proposes how to **finish the current sentence**, for every sentence.
- Use **free models from OpenRouter** (https://openrouter.ai/models); pick the best one for this use.
- The OpenRouter key is already stored in Cloudflare as **`API_KEY_OPENROUTER`**.
- **Do not change anything else. Do not change the interface. Only work with text.**

What "don't change the interface" means for the team, concretely:

- No new buttons, toggles, menus, popovers, badges, settings rows, tooltips or layout changes.
- The only new pixels are the gray continuation text inside a field that is being typed in.
- Every existing key keeps its meaning (Tab / Shift+Tab indent, Enter, Esc, Alt+↑↓, Cmd/Ctrl+Enter, Backspace on empty…).
- No changes to the data model, sync, numbering, stages or format config. A suggestion is
  local to the device and never written to the shared document until the user accepts it.
- All existing tests (`npm test`, `npm run e2e`) still pass, and screenshots with no suggestion
  showing are pixel-identical.

## 2. What the codebase already gives us

| Fact | Where | Consequence |
|---|---|---|
| Every round text field (card, point, thesis title, Doc view line, motion) is one component, a `<textarea>` bound to a `Y.Text`. | `src/ui/YTextEditor.tsx`; used in `Board.tsx` (3×), `DocView.tsx`, `SetupPanel.tsx` | Build the ghost text **once** in `YTextEditor`; all round fields get it. Non-round inputs (room code, palette search, speech times) are plain `<input>`s and are untouched. |
| Tab and Shift+Tab are taken (indent / outdent). | `editorKeys` in `Board.tsx`, `onKey` in `DocView.tsx` | Tab **cannot** accept a suggestion. Use **→ (Right Arrow) at the end of the text** (does nothing there today). |
| Esc stops editing. | same | Keep it: Esc ends editing and the ghost disappears with it. |
| The textarea has a transparent background and inherits font / line height. | `.ed` in `src/styles/app.css` | Ghost text can be drawn by a mirror layer behind the textarea with the same font and wrapping, no layout change. Use the existing `--c-text-muted` token (the placeholder colour), so no new design token. |
| One Worker serves `/api/*`; the service worker skips `/api/`. | `worker/index.ts`, `public/sw.js` | Add `POST /api/suggest` next to the room API. Nothing is cached by the SW. |
| Two people can type in the same card. | Yjs | Ghost text is per device. A remote edit at or before the caret discards the current ghost. Accepting inserts through the normal diff path, so it syncs, merges and undoes like typing (one undo step). |
| Rich context exists: motion, side, our role, current speech, thesis title, the opponent card this card answers (`respondsTo`), neighbouring cards. | `src/engine`, `src/sync/doc.ts` | Suggestions can be on-topic, not generic. |
| "Ocean vs Space" scenario data. | `e2e/ocean.ts` | Reuse it as the benchmark and test corpus. |

## 3. The decisions that matter (think these through first)

### 3.1 The free-tier limit is the biggest risk

OpenRouter limits for `:free` models (docs, checked 17.11.2026):

| Credits ever bought on the account | Requests / minute | Requests / day |
|---|---|---|
| under $10 | 20 | **50** |
| $10 or more | 20 | **1000** |

The key lives in the Worker, so **all users share one budget**. "A suggestion for every sentence"
is roughly one request per sentence typed. One practice round with two partners easily makes
100–300 sentences. **50 a day runs out in the first round; 1000 a day is about 3–10 rounds.**
20/minute is also tight when two people type at once.

Options:

- **A. (recommended) Buy $10 of OpenRouter credits once.** Models stay free (credits are not
  spent on `:free` models); the daily cap goes to 1000. Plus the request-saving measures below.
- B. Stay at 50/day and accept that suggestions stop after the first few dozen sentences each day.
- C. Later, a cheap paid model as an overflow fallback. Not now: the user asked for free models.

Request-saving measures (built regardless of the option):
1. Ask only after a typing pause (~700 ms), only with the caret at the end of the text, only when
   the current sentence has at least 3 words and does not already end in `.`, `!` or `?`.
2. One request in flight per device; a new keystroke cancels it (`AbortController`).
3. **Type-through**: if the user types the first letters of the ghost, keep showing the rest; no new request.
4. Cache by (context hash + text before the caret), in memory on the device and in the Worker's Cache API.
5. A global daily counter on the server (one small Durable Object, or KV) that stops calling
   OpenRouter at ~95 % of the cap and returns "no suggestion" quietly; the per-minute limit is
   handled the same way on `429` (back off, no error shown).

### 3.2 Privacy

Suggestions send round text (motion, card text) to OpenRouter and to whichever provider serves
the free model. Several free endpoints **may log prompts or use them for training** (the catalog
says so for some). For a practice tool this is probably fine, but it is the user's call.
Recommendation: accept it, and turn on OpenRouter's account privacy setting that excludes
providers which train on data wherever a free model still has a provider that allows it.

### 3.3 Accepting a suggestion

- Keyboard: **→ at the end of the text** accepts the whole suggestion. (Optional: Cmd/Ctrl+→ accepts one word.)
- **Tablets** (no arrow key on many on-screen keyboards): **tap on the gray text** accepts it.
  This is an interaction, not new interface.
- Anything else (typing on, Enter, Esc, Tab, clicking elsewhere) just ignores it.

### 3.4 Defaults the plan assumes (confirm or change)

- Suggestions are **on for everyone, always**, with no on/off switch (a switch would be interface).
  If an off switch is needed later, the existing command palette (Cmd/Ctrl+K) could hold it with no visible change.
- The suggestion finishes **only the current sentence** (max ~20 words), in the language the user
  is writing in, in the terse flowing style of the field (short card titles, not essays).
- Fields: cards, points, thesis titles, Doc view lines, and the motion field.
  (The motion is usually pasted; drop it if suggestions there feel odd.)
- **Not** shown in speech mode? Recommendation: show them; speech mode is about marking "said",
  and nobody types much then. Easy to change.

### 3.5 Where is the key, exactly?

"Set up in Cloudflare" can mean two different things, and the code differs:
- a **Worker secret** on the `debatable` Worker (Settings → Variables and Secrets) → read as `env.API_KEY_OPENROUTER`;
- a secret in the account-level **Secrets Store** → needs a `secrets_store_secrets` binding in `wrangler.jsonc`, read with `await env.API_KEY_OPENROUTER.get()`.

The API agent checks this first (dashboard or `wrangler secret list`). For local dev and the
benchmark, the key goes in `.dev.vars` (git-ignored) or, in a Claude cloud session, as a network
secret for `openrouter.ai` that the proxy injects; never in the repo or the client bundle.

## 4. Model choice

Free models on OpenRouter today (17 total, from `GET https://openrouter.ai/api/v1/models`).
What matters for inline completion, in order: **latency** (the ghost must appear within about a
second of the pause), **obeying "continue, don't repeat, stop at the sentence end"**, quality of
short English argument text, and **reliability** (free endpoints get rate limited upstream).
Reasoning models are a poor fit: thinking tokens add seconds, so reasoning must be switched off
(`reasoning: { enabled: false }` / `effort: "none"` where supported) or the model dropped.

| Model | Notes | Verdict |
|---|---|---|
| `google/gemma-4-26b-a4b-it:free` | Instruction-tuned MoE, ~3.8 B active → fast; strong English; thinking is optional | **Favourite** |
| `google/gemma-4-31b-it:free` | Dense 31 B, better quality, slower | **Fallback 1** |
| `nvidia/nemotron-3.5-lightning:free` | MoE, 3 B active, built for throughput | **Fallback 2 / speed contender** |
| `inclusionai/ling-3.2-flash:free`, `dots-studio/dots-3-note-preview:free`, `baidu/ernie-5.5-flash-preview:free`, `nvidia/nemotron-3.5-super-vl:free` | General models; hybrid reasoning or larger | Benchmark as contenders |
| `thinkingmachines/inkling-2-small:free`, `nvidia/nemotron-3-ultra-550b-a55b:free`, `nemotron-3-nano-omni…reasoning:free` | Reasoning-first or very large → too slow per keystroke pause | Exclude |
| `cohere/north-mini-code:free`, `recursive/flint-v1.0:free`, `particle-ai/particle-1:free` | Coding / agent models | Exclude |
| `liquid/lfm-3-1.7b:free` | Tiny, "reasons before it answers", retains prompts | Exclude |
| `google/lyria-3-*` | Music models | Exclude |
| `openrouter/free` | Random free model per call → inconsistent style | Last-resort fallback only |

The final choice is made by the **benchmark** (agent 2), not by this table. Ship with a fallback
list using OpenRouter's `models: [primary, fallback1, fallback2]` field, so one endpoint being
down or rate limited does not stop suggestions. The model list lives in config
(`src/config/suggest.ts`), not in code paths, so it can be swapped when the free catalog changes
(it changes often; re-check quarterly).

## 5. The team

Six agents. The lead is this (main) session; the others are spawned with the Agent tool, each with
the brief in section 7. Each agent **owns its files**; nobody edits another agent's files
without going through the lead. This avoids merge conflicts when they work in parallel.

| # | Agent | Expertise | Owns (files) | Delivers |
|---|---|---|---|---|
| 0 | **Lead / integrator** | Whole codebase, product rules | `docs/*`, `CLAUDE.md`, the API contract `src/shared/suggest.ts` (types only) | Decisions recorded, contract, integration, commits |
| 1 | **Cloudflare API engineer** | Workers, secrets, Durable Objects, rate limiting | `worker/suggest.ts`, `/api/suggest` route in `worker/index.ts`, `wrangler.jsonc` bindings, `worker-configuration.d.ts` | Endpoint calling OpenRouter with the key, quota guard, cache, abuse protection |
| 2 | **LLM evaluation & prompt engineer** | Model benchmarking, prompt design | `src/shared/suggest-prompt.ts` (prompt builder, pure), `src/config/suggest.ts` (models, limits), `scripts/bench-suggest.ts`, `docs/plans/ai-suggestions-bench.md` | The chosen model + fallbacks with numbers, the prompt, post-processing rules |
| 3 | **Editor / ghost-text engineer** | React, textarea internals, IME, caret math | `src/ui/YTextEditor.tsx`, new `src/ui/suggest/*` (client hook, cache, trigger logic), ghost CSS in `app.css` | Gray inline continuation in every `YTextEditor`, accept / dismiss behaviour |
| 4 | **Flow-context engineer** | The engine and Yjs doc model | `src/ui/suggest/context.ts`, the `suggest` prop passed at the 5 call sites | The structured context for each field (motion, side, speech, thesis, answered card, neighbours) |
| 5 | **QA & review** | Vitest, Playwright, security review | `src/**/*.test.ts` for the new code, `e2e/suggest.spec.ts` | Tests, "nothing else changed" proof, security/abuse review |

Why this split: the model/prompt work and the UI work are independent once the API contract is
fixed, so agents 1–4 can run in parallel. The prompt builder is **shared code** used by both the
Worker and the benchmark, so the benchmark tests exactly what ships.

## 6. Phases

```
Phase 0  Lead: decisions + contract ───────────────┐
                                                    ├─► Phase 1 (parallel)
   1 API engineer  ──── endpoint against contract   │     2 Bench + prompt (needs the key)
   3 Ghost text UI ──── against a mocked endpoint   │     4 Context builder
                                                    ▼
Phase 2  Lead: integrate, wire real model list, manual check in the browser
Phase 3  QA & review: tests, regression, screenshots, security
Phase 4  Lead: docs, commit, deploy (only with the user's go-ahead)
```

### Phase 0: lead (blocking, ~short)
1. Get answers to section 3 (budget option, privacy, accept keys, fields), or apply the recommended defaults.
2. Confirm where the key is (3.5) and how the benchmark gets it.
3. Write the contract in `src/shared/suggest.ts`:
   ```ts
   // POST /api/suggest
   interface SuggestRequest {
     room: string;            // room code, must exist (abuse guard)
     device: string;          // anonymous device id
     field: "card" | "point" | "thesis" | "motion" | "doc";
     before: string;          // text of the field up to the caret (trimmed to the last ~600 chars)
     context: {
       format: string; side: "gov" | "opp"; speech: string;   // e.g. "LOC"
       motion?: string; thesis?: string;
       answers?: string[];    // text of the opponent card(s) this card answers
       siblings?: string[];   // up to ~5 nearby card titles, for style
     };
   }
   interface SuggestResponse { text: string; model?: string } // text = continuation only, "" = none
   ```
   The client sends **structured context, not a prompt**: the Worker builds the prompt. That keeps
   the free key from being usable as a general-purpose LLM proxy.
4. Add a short feature entry to `CLAUDE.md` (spec table) and the defaults to `docs/decisions.md`.

### Phase 1a: Cloudflare API engineer (agent 1)
- `POST /api/suggest` in the existing Worker; validates the body (sizes, enums), checks the room
  code exists, rejects other origins.
- Builds the prompt with `src/shared/suggest-prompt.ts`; calls
  `https://openrouter.ai/api/v1/chat/completions` with `Authorization: Bearer <API_KEY_OPENROUTER>`,
  `models: [...]` fallback list from `src/config/suggest.ts`, `max_tokens` ~40, low temperature,
  `stop` at sentence ends, reasoning off, a ~4 s timeout, and the `HTTP-Referer` / `X-Title`
  headers OpenRouter uses to identify the app.
- Post-processes with the shared rules (strip quotes, strip echoed prefix, cut at the first
  sentence end, drop if empty or nonsense).
- Quota guard: global daily counter (Durable Object or KV) + per-device and per-IP soft limits;
  on any limit or upstream error returns `{ text: "" }` with 200 (or 429 with `retry-after`) so
  the client stays silent.
- Cache API keyed by a hash of the request.
- Never logs the key; never returns upstream error bodies to the client.
- Done: unit tests with a mocked `fetch`; works under `vite preview` (workerd) with `.dev.vars`.

### Phase 1b: LLM evaluation & prompt engineer (agent 2)
- Build a corpus of ~60 sentence prefixes from `e2e/ocean.ts` and spec 02 examples: card titles,
  points, thesis titles, answers to opponent cards, cut at 3–8 words; plus a few non-English and a
  few edge cases (ends with a comma, a number, an abbreviation like "e.g.").
- Write the prompt (system + user) and post-processing rules in `src/shared/suggest-prompt.ts`.
  Key rules for the model: output **only the continuation**, never repeat the given text, finish
  the current sentence only, match the terse flowing style, same language, no quotes, no prefaces.
- `scripts/bench-suggest.ts`: runs every shortlisted model (section 4) on the corpus, 2 rounds,
  respecting 20 req/min. Measures per model: time to full answer p50 / p95, error and empty rate,
  format compliance (auto-checked), and quality (scored 1–5 by a judge, plus a sample read by a person).
  Budget: ~60 prefixes × ~6 models × 2 = ~720 requests → needs the 1000/day tier, or spread over
  several days, or a smaller corpus (20 prefixes) at 50/day.
- Picks: primary + 2 fallbacks; writes results and the reasons to `docs/plans/ai-suggestions-bench.md`
  and the list to `src/config/suggest.ts`.
- Done: a table with numbers, a recommendation, and the prompt passing the format checks ≥ 95 %.

### Phase 1c: Editor / ghost-text engineer (agent 3)
- In `YTextEditor`: a mirror `<div>` behind the textarea with identical font, padding and wrapping;
  it holds the real text in transparent colour plus the suggestion in `var(--c-text-muted)`, so the
  gray text starts exactly at the caret and wraps like real text. `aria-hidden`; the textarea's
  height (autosize) is computed **without** the ghost, so nothing moves on the page.
- Trigger rules from 3.1; cancel on keystroke; type-through; discard on remote edit before the
  caret, on blur, on IME composition, when the selection is not a collapsed caret at the end.
- Accept: → at the end (and tap on the gray text on touch) inserts through the existing diff path
  in one transaction (one undo step), then moves the caret to the end. All other keys pass through
  untouched to `onKeyDown`, so `editorKeys` / Doc view behaviour is unchanged.
- Works against a mock `/api/suggest` first (a dev flag or Playwright route), so it does not wait for agent 1.
- Done: visible in all 5 field types; no layout shift; existing e2e green.

### Phase 1d: Flow-context engineer (agent 4)
- A pure function that, given the session, flow and the field being edited, returns the
  `context` object of the contract: motion, our side, the column's speech, the thesis title, the
  text of answered opponent cards (`respondsTo`), a few sibling card titles.
- Adds an optional `suggest` prop to `YTextEditor` and passes it at the 5 call sites
  (the only edits outside the editor, and they change no behaviour).
- Done: unit tests on the "Ocean vs Space" board for each field kind.

### Phase 2: lead integrates
- Merge the four parts, switch the editor from the mock to the real endpoint, run locally with the
  key, type through a full "Ocean vs Space" round by hand, tune debounce and length.

### Phase 3: QA & review (agent 5)
- Unit: trigger rules, type-through, post-processing, cache, quota guard.
- E2E `e2e/suggest.spec.ts` (endpoint mocked with `page.route`, never the real API in CI):
  ghost appears after a pause in a card / point / thesis / Doc line / motion; → accepts; typing
  through keeps the rest; Enter, Tab, Esc behave exactly as before; partner sees accepted text
  only; Cmd/Ctrl+Z removes an accepted suggestion in one step; offline → no ghost, no error.
- Regression: full `npm test` and `npm run e2e`; screenshot comparison of the main screens with no
  suggestion visible = identical to before.
- Security review: the key is not in the client bundle (`grep` the build output), the endpoint
  can't be used as a free general LLM proxy, sizes are capped, upstream errors are not leaked.

### Phase 4: lead ships
- Update `docs/decisions.md`, `docs/progress.md`, `README.md`, `CLAUDE.md`.
- Commit each step on the development branch.
- Deploy with `npm run deploy` **only after the user says go**; then check the key binding works
  on https://debatable.nikiash704.workers.dev.

## 7. Agent briefs (paste into the Agent tool)

Every brief starts with: *"Read `CLAUDE.md` and `docs/plans/ai-suggestions.md` in full. You own only
the files listed for you; ask the lead before touching others. Do not change any UI, key binding,
data model or test expectation outside this feature. Commit nothing; report back with the diff
summary and test results."*

- **Agent 1, Cloudflare API engineer:** "Implement `POST /api/suggest` per Phase 1a and the contract
  in `src/shared/suggest.ts`. First determine whether `API_KEY_OPENROUTER` is a Worker secret or a
  Secrets Store secret and bind it accordingly. Mock OpenRouter in tests."
- **Agent 2, LLM evaluation & prompt engineer:** "Do Phase 1b. Shortlist from section 4; re-fetch
  `https://openrouter.ai/api/v1/models` first in case the free list changed. Stay within 20 req/min.
  Report the table and your pick with reasons."
- **Agent 3, Editor / ghost-text engineer:** "Do Phase 1c in `YTextEditor`. Work against a mocked
  endpoint. Prove no layout shift and that every existing key behaves the same."
- **Agent 4, Flow-context engineer:** "Do Phase 1d. Pure function + unit tests; pass the prop at the
  5 call sites without changing anything else they do."
- **Agent 5, QA & review:** "Do Phase 3 once the lead has integrated. Report failures with output;
  do not weaken or skip existing tests."

## 8. Definition of done

1. Typing a sentence and pausing in any round field shows a gray continuation within ~1 s (p50).
2. → (or a tap on the gray text) accepts it; everything else ignores it; one undo removes it.
3. The partner never sees a suggestion, only accepted text.
4. When the quota is used up, offline, or the model fails: no ghost, no error, nothing else changes.
5. The key never reaches the browser; the endpoint only completes debate-flow sentences.
6. All earlier unit and e2e tests pass; screens without a suggestion are pixel-identical.
7. Model choice is backed by the benchmark table in `docs/plans/ai-suggestions-bench.md`.

## 9. Open questions for the user

1. Budget: buy $10 of OpenRouter credits for 1000 free requests/day (recommended), or live with 50/day?
2. Privacy: OK to send round text to free model providers that may log it?
3. Accept key → at the end of the text, and tap-to-accept on tablets: OK? (Tab is taken by indent.)
4. Include the motion field, or only flow fields (cards, points, theses, Doc view)?
5. Is `API_KEY_OPENROUTER` a Worker secret on `debatable` or in the account Secrets Store?
