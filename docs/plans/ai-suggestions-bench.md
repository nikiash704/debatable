# AI suggestions: model benchmark and prompt

Status: **method, corpus, prompt and script ready; NOT YET MEASURED.** Written 17.11.2026 by the
evaluation agent (Phase 1b of `docs/plans/ai-suggestions.md`). The OpenRouter key exists only as a
Worker secret, so no model was called from the dev machine. The numbers come from running
`scripts/bench-suggest.ts` against the deployed Worker; fill in section 7 then.

Files: `src/shared/suggest-prompt.ts` (prompt + `postProcess`, shared by the Worker and the bench),
`src/shared/suggest-prompt.test.ts`, `src/config/suggest.ts` (model lists), `scripts/bench-corpus.ts`
(corpus + automatic format checks), `scripts/bench-suggest.ts` (runner).

## 1. Free catalog, re-checked 17.11.2026

`GET https://openrouter.ai/api/v1/models` (public): **17 free models, the same list as section 4 of
the plan.** Endpoint metadata from `GET /api/v1/models/<id>/endpoints`. Every free model has a single provider.

| Model | Active / total params | Provider | `stop` supported | Reasoning params | Uptime 1 d | Verdict |
|---|---|---|---|---|---|---|
| `google/gemma-4-26b-a4b-it:free` | 3.8 B / 25 B MoE | Google AI Studio | no | `reasoning`, `include_reasoning` | 100 % | **Primary** |
| `nvidia/nemotron-3.5-lightning:free` | 3 B / 30 B MoE | Nvidia | no | `reasoning`, `include_reasoning` | 99.9 % | **Fallback 1** (other provider) |
| `google/gemma-4-31b-it:free` | 31 B dense | Google AI Studio | no | `reasoning`, `include_reasoning` | 100 % | **Fallback 2** (quality) |
| `inclusionai/ling-3.2-flash:free` | not stated (hybrid reasoning) | Ant Digital | **yes** | `reasoning`, `include_reasoning` | 100 % | Contender (would add a 3rd provider) |
| `dots-studio/dots-3-note-preview:free` | 16 B / 280 B MoE | AtlasCloud | no | `reasoning`, `include_reasoning` | 99.9 % | Contender (bigger, slower) |
| `baidu/ernie-5.5-flash-preview:free` | ? / 280 B | Baidu | no | `reasoning`, `reasoning_effort`, `include_reasoning` | 100 % | Contender (coding/agentic focus) |
| `nvidia/nemotron-3.5-super-vl:free` | 12 B / 120 B MoE | Nvidia | no | `reasoning`, `include_reasoning` | 100 % | Contender (same provider as fallback 1) |
| `thinkingmachines/inkling-2-small:free` | 17 B / 594 B | | yes | reasoning model | | Excluded: reasoning-first |
| `nvidia/nemotron-3-ultra-550b-a55b:free` | 55 B / 550 B | | no | reasoning model | | Excluded: too big / slow |
| `nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free` | 3 B / 30 B | | no | reasoning variant | | Excluded: reasoning variant |
| `liquid/lfm-3-1.7b:free` | 1.7 B | | yes | "reasons before it answers"; retains prompts | | Excluded |
| `cohere/north-mini-code:free`, `recursive/flint-v1.0:free`, `particle-ai/particle-1:free` | | | | coding / agent models | | Excluded |
| `google/lyria-3-pro-preview`, `google/lyria-3-clip-preview` | | | | music | | Excluded |
| `openrouter/free` | random free model | | | | | Excluded: inconsistent style; last resort only |

Why this shortlist (unchanged from the plan, re-ordered):
- Inline completion needs **latency first** (a ghost later than ~1 s after the pause is useless), then
  **obedience** (continue, don't repeat, stop at the sentence end), then short English argument quality.
  Low active parameters = fast first token and fast decoding; instruction-tuned general models obey
  format instructions better than coding/agent models.
- **Fallback 1 is now Nemotron 3.5 Lightning, not Gemma 31B** (changed in `src/config/suggest.ts`):
  both Gemmas run on the same free Google AI Studio endpoint, so a Google-side 429 or outage would
  fail the first two tries in a row and burn the Worker's 4 s timeout. A different provider for
  fallback 1 makes the `models` list actually fail over. Gemma 31B stays as the quality fallback.
- Ling 3.2 Flash is the only shortlisted model that honours `stop` and would add a third provider;
  if it measures fast and compliant, it should replace Gemma 31B as fallback 2.

### Turning thinking off

All shortlisted models list `reasoning` and `include_reasoning`; none is reasoning-only. The Worker
sends OpenRouter's unified **`reasoning: { enabled: false }`** (equivalent: `reasoning: { effort: "none" }`;
Ernie also lists `reasoning_effort`). Do **not** rely on `include_reasoning: false` or
`reasoning: { exclude: true }`: they only hide the thinking, the model still spends the time.
The catalog does not say which models think by default (Gemma 4: "configurable thinking mode";
Ling 3.2 Flash: "hybrid reasoning"; the Nemotron 3.5 models: hybrid). The bench shows it indirectly:
a model that still thinks has a high p50, more timeouts (the Worker cuts at 4 s) and more empty
answers (thinking eats `max_tokens: 40`). `postProcess` also strips `<think>…</think>` text and returns
nothing when a reasoning block was cut off.

### `stop` and the Worker

Only Ling 3.2 Flash (of the shortlist) supports `stop`; for the others OpenRouter drops the Worker's
`stop: ["\n"]` silently, so `postProcess` keeps only the first answer line itself. For a model that
does honour it, a reply that starts with a newline or a one-line preface ("Sure!\n…") comes back empty.
**Suggestion to the API owner:** drop `stop: ["\n"]` (it saves at most a few tokens under
`max_tokens: 40`, and `postProcess` already handles extra lines), and never set
`provider.require_parameters: true` while sending `stop`, or every model without `stop` support
would be skipped.

## 2. The prompt (as shipped in `src/shared/suggest-prompt.ts`)

System:

```
You autocomplete a debater's notes (a parliamentary debate flow).
Reply with one line: the note's last word (completed if it is cut off), then the words that finish the note's current sentence.
Write like the nearby notes: terse, no filler, no final full stop unless they use one. Same language as the note. At most 12 words.
Nothing else: no quotes, labels, explanations or options.
```

Then two short example turns (user → assistant), then the request:

```
user:      Motion: THW ban zoos
           Opposition's flow, our own LOC speech. Field: argument card title.
           Nearby notes: Zoos fund conservation | Breeding saves species
           Note: Kids learn empathy from se
assistant: seeing real animals
user:      Motion: THW ban zoos
           Government's flow, our own MG speech. Field: argument card title.
           Answers the opponent's note: Zoos fund conservation
           Note: Most of that money goes to␠
assistant: to marketing, not habitats
user:      Motion: THW prioritise ocean exploration over space exploration
           Opposition's flow, notes on the Government's PMC speech. Field: argument card title.
           Nearby notes: Climate answers are in the ocean | Cheaper per discovery | Food security | Space race is militarised
           Note: Oceans are 95%
```

Lines appear only when the context has them: `Motion` (else `Format: <name>`), the where-line,
`Thesis`, `Card` (for a point), `Answers the opponent's note`, `Nearby notes`, `Note`.
About 260–400 input tokens per request (≈ 4 chars per token), at most ~22 output tokens.

Design choices:
- **Echo the last word, then continue.** A chat model cannot be trusted to emit a leading space or
  to complete half a word; it can be trusted to write whole words. So it repeats the note's last
  (possibly cut-off) word and `postProcess` removes it: "unl" + "unlocks scarce metals" → "ocks
  scarce metals"; "for␠" + "for humanity" → "humanity". The spacing falls out right in both cases.
- **Two examples instead of more rules**: they show the reply shape, mid-word and after a space,
  better than instructions, for ~80 extra input tokens (input is cheap in latency; output is not).
  The examples use a different motion, so they do not leak into the corpus.
- **Whose speech the column is** comes from the format config (`FORMATS`, no hard-coded APDA):
  "notes on the Government's PMC speech" tells the model it is writing down the opponent's argument,
  so it should continue *their* case, not argue against it.
- Same language as the note; terse; at most 12 words (`postProcess` hard-caps at 15).

## 3. Post-processing rules (`postProcess(before, raw)`)

In order: strip `<think>`-style blocks (nothing if one is left open; text after a lone closing tag);
keep the first line that is not empty, a code fence or a preface ("Sure!", "Here's the continuation:");
strip inline prefaces and labels ("Sure! ", "Continuation: ", "Note: "); strip markdown (list/heading
markers, `**`, `*`, backticks); strip wrapping quotes (a closing quote stays if the note has an open
one; a leading `'s` is not a quote); strip a leading "..." (glued to a letter = mid-word); remove an
echo of the end of `before` (whole text, current sentence, last words or the last word; longest
match; after a space the last word must match as a whole word); otherwise join with one space after
a word or closing punctuation, none before `, . ; : ! ? ) %` or `'s`, none after `( - $`; no leading
space if `before` ends with whitespace; cut after the first sentence end (not after e.g., i.e., vs.,
etc., initials, U.S., decimals); cap at 15 words; drop a trailing ellipsis or dangling `, ; : -`;
return "" for placeholders (N/A, none, [..]) or text with no letter or digit.
34 unit tests in `src/shared/suggest-prompt.test.ts` cover these with realistic bad outputs, plus a
property test: for every corpus item with a reference, the echo-convention answer post-processes to
exactly the reference.

## 4. Method

**Corpus** (`scripts/bench-corpus.ts`): 58 items, each the exact request a field sends (contexts
produced by `buildSuggestInput` on the "Ocean vs Space" board at the stage the note is typed, plus two
generic APDA flows: Government on standardized testing, Opposition on social media). Every `before`
passes the client's trigger rule (`shouldSuggest`), checked by a unit test.
- Fields: card 36 (own arguments, opponent cards, answers with `answers`, rebuttals), point 10,
  thesis 3, doc-card 3, doc-point 2, doc-thesis 1, motion 3.
- Cuts: after a finished word 25, after a space 14, mid-word 8.
- Edge cases (14): ends with a comma, a colon, a number / `%` / `$25`, an apostrophe, a hyphen, an open
  bracket; "e.g." and "vs." inside; a second sentence; two Russian notes (one with English context);
  one ~480-character Doc view line.
- 33 items have a `reference` (what the debater actually wrote) for the judge.

**Per request** the bench records wall time of `POST /api/suggest` (Worker + OpenRouter; the Worker
cuts upstream at 4 s, so slower answers are timeouts), the outcome, the `x-suggest-skip` reason, the
served model and the post-processed text.

**Outcomes:** `ok`, `empty` (200, `text: ""`, no skip header: the model's answer was emptied by
post-processing), `timeout` (`upstream-timeout`), `rate-limited` (`upstream-429`), `error` (other
`upstream-*`). Our own limits (`quota-minute/-device/-ip/-backoff/-unavailable`, `room-lookup`) are not
counted against the model: the bench waits and retries. `quota-daily`, `no-key`, 400, 403, 404 stop
the run; six `quota-backoff` in a row stop it too (OpenRouter's account limit is used up).

**Automatic format checks** (`checkFormat`, on ok answers): no newline; no wrapping quotes; no
markdown; no reasoning tags; no echo of the last word or the whole text; ≤ 15 words; at most one
sentence end, at the end; spacing (no leading space after a space; for items cut after a finished word
the text must start with a space or punctuation; for mid-word cuts it must start with a letter);
same script as the note (Cyrillic vs not). Format pass = non-empty and no failure.

**Pacing:** sequential requests, ≤ 14/min (the Worker allows 15/min per IP, 20/min overall), device
ids rotated so none exceeds ~5/min (limit 6). Jobs run item by item with all models interleaved, so a
run cut short by `--budget` still compares models on the same items. Default budget: 300 requests.

**Quality:** not automatic. `answers.jsonl` has `context`, `before`, `text`, `joined` (what the user would see
after accepting) and `reference` per answer. Score each with a judge, 1–5, and have a person read
~20 random answers per finalist. Judge prompt:

```
You grade autocomplete suggestions for a debater's flow notes. For each item you get the context
(motion, side, speech, thesis, the opponent note it answers), the note text before the caret,
the suggestion, and (sometimes) what the debater really wrote.
Score 1–5: 5 = exactly what a good debater would write next (terse, on point, right side of the
argument); 3 = plausible but generic or slightly off; 1 = wrong, off-topic, wrong language, or broken
spacing. Judge the joined text. The reference is one good answer, not the only one.
Reply as JSON lines: {"id": …, "model": …, "score": n, "why": "≤ 10 words"}.
```

**Decision rule** (per model, over all its attempts): p50 ≤ 1.2 s and p95 ≤ 3.5 s; errors + timeouts
+ 429 ≤ 5 %; format pass of non-empty ≥ 95 % and empty ≤ 5 %; mean judge score ≥ 3.5. Among the models
that pass, the best judge score is the primary; fallback 1 = the best one on a **different provider**;
fallback 2 = the next best. Ties go to the lower p50.

## 5. How to run (after deploy)

Needs: the Worker deployed with the `model` request field and `SUGGEST_CONFIG.benchModels` as in this
repo; the key set; no other heavy use that day (the bench draws from the same 950/day budget as users).
Runs on Node 26 as is; `npx tsx scripts/bench-suggest.ts …` also works (tsx is not a project dependency).

```sh
# 0. See the prompts and the plan, no network
node scripts/bench-suggest.ts --dry --n 10

# 1. Screening: 20 items spread over the corpus × 7 models = 140 requests (~10 min)
node scripts/bench-suggest.ts --base https://debatable.nikiash704.workers.dev --n 20

# 2. Finalists: the whole corpus × the best 3 = 174 requests (~13 min)
node scripts/bench-suggest.ts --base https://debatable.nikiash704.workers.dev \
  --models google/gemma-4-26b-a4b-it:free,nvidia/nemotron-3.5-lightning:free,google/gemma-4-31b-it:free \
  --budget 180
```

Options: `--room CODE` (an existing room; otherwise the script claims a fresh code, which counts as
existing for 24 h), `--models a,b`, `--n N` (N items spread evenly), `--rounds R`, `--budget B`
(default 300), `--rpm` (default and max 14), `--ids a,b`, `--tags card,edge,mid-word`, `--out DIR`
(default: a new folder in the OS temp dir). Ctrl+C stops and still writes the summary.
Output: a markdown table on stdout and in `DIR/summary.md`; raw answers in `DIR/answers.jsonl`.
Total for both passes: ~320 requests, a third of a day's budget; spread over two days without $10 of credits (50/day).

## 6. Provisional recommendation (NOT MEASURED)

Ship `models: [gemma-4-26b-a4b-it, nemotron-3.5-lightning, gemma-4-31b-it]` (all `:free`), already set
in `src/config/suggest.ts`, with the prompt above, `temperature: 0.3`, `max_tokens: 40`,
`reasoning: { enabled: false }`. Reasons: smallest active parameter counts among instruction-tuned
general models (latency), Gemma 4's strong English and instruction following, and two providers in the
first two slots. Replace after the bench if a contender wins on the decision rule.

## 7. Results (fill in after the runs)

Screening, date: ____, items: __, requests: __

| Model | n | p50 ms | p95 ms | error % | timeout % | 429 % | empty % | format pass % | of non-empty | avg words | judge 1–5 |
|---|---|---|---|---|---|---|---|---|---|---|---|
| `google/gemma-4-26b-a4b-it:free` | | | | | | | | | | | |
| `nvidia/nemotron-3.5-lightning:free` | | | | | | | | | | | |
| `google/gemma-4-31b-it:free` | | | | | | | | | | | |
| `inclusionai/ling-3.2-flash:free` | | | | | | | | | | | |
| `dots-studio/dots-3-note-preview:free` | | | | | | | | | | | |
| `baidu/ernie-5.5-flash-preview:free` | | | | | | | | | | | |
| `nvidia/nemotron-3.5-super-vl:free` | | | | | | | | | | | |

Finalists, date: ____, items: 58, requests: __ (same columns)

Decision: primary ____, fallback 1 ____, fallback 2 ____. Reasons: ____

## 8. Notes for the other owners (not changed by this agent)

- **Worker** (`worker/suggest.ts`): consider dropping `stop: ["\n"]` (section 1). For bench requests
  only (`model` set), returning the raw upstream text and `usage` (incl. reasoning tokens) next to
  `text` would let the bench tell "the model said nothing" from "post-processing removed it", and see
  hidden thinking. Today the bench sees only the post-processed text.
- **Client** (`src/ui/suggest/rules.ts`): `currentSentence` treats "e.g. " / "vs. " as a sentence end,
  so "Spin-offs, e.g. GPS and" counts only 2 words and asks nothing. Minor.
- A model slower than the Worker's 4 s timeout shows up as `timeout`, never as a long latency.
