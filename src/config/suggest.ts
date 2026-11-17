/**
 * AI sentence suggestions: models and tuning. Config, not code: swap models here when the
 * OpenRouter free catalog changes. Initial values from docs/plans/ai-suggestions.md (section 4);
 * the benchmark (docs/plans/ai-suggestions-bench.md) decides the final list.
 */
export const SUGGEST_CONFIG = {
  /** Tried in order via OpenRouter's `models` fallback list. Free (`:free`) models only. */
  models: ["google/gemma-4-26b-a4b-it:free", "google/gemma-4-31b-it:free", "nvidia/nemotron-3.5-lightning:free"],
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
