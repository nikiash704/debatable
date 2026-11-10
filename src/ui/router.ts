import { useSyncExternalStore } from "react";

/** Tiny router: "/", "/r/CODE", "/dev/gallery". */
const listeners = new Set<() => void>();

function notify() {
  listeners.forEach((l) => l());
}

window.addEventListener("popstate", notify);

export function navigate(path: string, replace = false) {
  if (location.pathname === path) return;
  if (replace) history.replaceState(null, "", path);
  else history.pushState(null, "", path);
  notify();
}

export function usePath(): string {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => location.pathname,
  );
}

export function roomPath(code: string) {
  return `/r/${code}`;
}

export function inviteLink(code: string) {
  return `${location.origin}/r/${code}`;
}
