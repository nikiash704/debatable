/** localStorage helpers that never throw (private mode, blocked storage). */
export function readJSON<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

export function writeJSON(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage unavailable: the app still works for this session */
  }
}

export function randomId(len = 16): string {
  const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
  const bytes = new Uint8Array(len);
  crypto.getRandomValues(bytes);
  let s = "";
  for (const b of bytes) s += alphabet[b % alphabet.length];
  return s;
}

/** Anonymous device id (spec 01): later an account can adopt every room this device touched. */
export function getDeviceId(): string {
  const key = "debatable.deviceId";
  let id = readJSON<string | null>(key, null);
  if (!id) {
    id = `dev-${randomId(20)}`;
    writeJSON(key, id);
  }
  return id;
}

let persistAsked = false;
/** Ask the browser to keep our IndexedDB data (helps against Safari's 7-day eviction). */
export function requestPersistentStorage() {
  if (persistAsked) return;
  persistAsked = true;
  try {
    void navigator.storage?.persist?.();
  } catch {
    /* ignore */
  }
}
