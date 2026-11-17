/**
 * Contract for AI sentence suggestions (ghost text), `POST /api/suggest`.
 * Plan: docs/plans/ai-suggestions.md. Shared by the client, the Worker and the benchmark.
 *
 * The client sends structured context, never a prompt: the Worker builds the prompt
 * (src/shared/suggest-prompt.ts), so the OpenRouter key cannot be used as a general LLM proxy.
 */

/** Which kind of round text field is being typed in. */
export type SuggestField = "card" | "point" | "thesis" | "motion" | "doc-thesis" | "doc-card" | "doc-point";

export interface SuggestContext {
  /** Format id from the format config, e.g. "apda". */
  format: string;
  /** Side whose flow this field belongs to (format side id, e.g. "gov" / "opp"). */
  side: string;
  /** Speech of the column the field is in (e.g. "LOC"); absent for the motion. */
  speech?: string;
  motion?: string;
  /** Title of the thesis the card / point belongs to. */
  thesis?: string;
  /** For a point: the text of its card. */
  card?: string;
  /** Text of the opponent card(s) this card answers (`respondsTo`). */
  answers?: string[];
  /** A few nearby card titles of the same column, for style. */
  siblings?: string[];
}

export interface SuggestRequest {
  /** Room code; must exist on the server. */
  room: string;
  /** Anonymous device id. */
  device: string;
  field: SuggestField;
  /** Text of the field up to the caret (the client sends at most SUGGEST_LIMITS.before chars). */
  before: string;
  context: SuggestContext;
  /** Benchmark only: ask one model instead of the fallback list. Must be in SUGGEST_CONFIG.benchModels. */
  model?: string;
}

export interface SuggestResponse {
  /** Continuation only (what goes after `before`); "" = no suggestion. */
  text: string;
  /** Model that answered (for diagnostics). */
  model?: string;
}

/** Size caps, enforced by the client (trimming) and the Worker (rejecting). */
export const SUGGEST_LIMITS = {
  before: 600,
  contextItem: 300,
  listItems: 6,
  /** Whole request body, bytes. */
  body: 8 * 1024,
} as const;

/** What a field needs to ask for a suggestion; `before` and `device` are filled in by the editor. */
export type SuggestInput = Omit<SuggestRequest, "before" | "device" | "model">;
