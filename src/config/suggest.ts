/**
 * AI sentence suggestions: models and tuning. Config, not code: swap models here when the
 * OpenRouter free catalog changes. Initial values from docs/plans/ai-suggestions.md (section 4);
 * the benchmark (docs/plans/ai-suggestions-bench.md) decides the final list.
 */
export const SUGGEST_CONFIG = {
  /**
   * Tried in order via OpenRouter's `models` fallback list. Free (`:free`) models only.
   * PROVISIONAL (catalog re-checked 17.11.2026, not yet measured): fallback 1 runs on a different
   * provider (Nvidia) than the primary (Google AI Studio), so a Google-side 429 or outage does not
   * take out the first two tries; the dense Gemma is the quality fallback. Reasons and numbers:
   * docs/plans/ai-suggestions-bench.md.
   */
  models: ["google/gemma-4-26b-a4b-it:free", "nvidia/nemotron-3.5-lightning:free", "google/gemma-4-31b-it:free"],
  /**
   * Models the benchmark may ask one by one through /api/suggest (`model` field). Free only.
   * Order = benchmark priority (the shipped three first). Excluded on purpose: reasoning-first,
   * very large, coding/agent, music and router models (see the bench doc).
   */
  benchModels: [
    "google/gemma-4-26b-a4b-it:free",
    "nvidia/nemotron-3.5-lightning:free",
    "google/gemma-4-31b-it:free",
    "inclusionai/ling-3.2-flash:free",
    "dots-studio/dots-3-note-preview:free",
    "baidu/ernie-5.5-flash-preview:free",
    "nvidia/nemotron-3.5-super-vl:free",
  ],
  /** Echoed last word + at most 12 words ≈ 20 tokens; the rest is headroom for a stray preface. */
  maxTokens: 40,
  temperature: 0.3,
  /** Upstream timeout in the Worker, ms. */
  timeoutMs: 4000,
  /** Typing pause before asking, ms. */
  debounceMs: 700,
  /** Minimum words in the current sentence before asking. */
  minWords: 3,
  /** OpenRouter free tier: 20/min, 1000/day with $10+ credits bought (50/day without). */
  dailyCap: 1000,
  /** Stop calling upstream at this share of the daily cap. */
  dailyCapShare: 0.95,
  perMinuteCap: 20,
} as const;
