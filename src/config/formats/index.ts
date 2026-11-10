import type { FormatConfig } from "../types";
import { APDA } from "./apda";

/** Registered formats. Adding BP = adding a config file here; the engine does not change. */
export const FORMATS: Record<string, FormatConfig> = {
  [APDA.id]: APDA,
};

export const DEFAULT_FORMAT_ID = APDA.id;

export function getFormat(id: string | null | undefined): FormatConfig {
  return (id && FORMATS[id]) || FORMATS[DEFAULT_FORMAT_ID];
}

/** The format with a room's speech-time overrides applied (speech times are configurable). */
export function withTimes(
  format: FormatConfig,
  times: Record<string, number> | null | undefined,
  prepMinutes?: number | null,
): FormatConfig {
  const hasTimes = times && Object.keys(times).length > 0;
  if (!hasTimes && (prepMinutes == null || prepMinutes === format.prepMinutes)) return format;
  return {
    ...format,
    prepMinutes: prepMinutes ?? format.prepMinutes,
    speeches: format.speeches.map((s) => {
      const m = times?.[s.id];
      return typeof m === "number" && m > 0 ? { ...s, minutes: m } : s;
    }),
  };
}
