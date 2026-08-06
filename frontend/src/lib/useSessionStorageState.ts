import { useState } from "react";

// Drop-in replacement for useState that persists to sessionStorage — same
// API shape (value + setter accepting either a value or an updater
// function), so swapping useState(initial) for specific fields is a
// minimal-diff change. Scoped to sessionStorage (not localStorage) so it
// survives navigating between pages and an accidental refresh, but clears
// itself once the tab actually closes rather than lingering forever.
export function useSessionStorageState<T>(
  key: string,
  initialValue: T,
): [T, (value: T | ((prev: T) => T)) => void] {
  const [state, setState] = useState<T>(() => {
    try {
      const stored = sessionStorage.getItem(key);
      return stored !== null ? (JSON.parse(stored) as T) : initialValue;
    } catch {
      return initialValue;
    }
  });

  function setPersistedState(value: T | ((prev: T) => T)) {
    setState((prev) => {
      const next = typeof value === "function" ? (value as (prev: T) => T)(prev) : value;
      try {
        sessionStorage.setItem(key, JSON.stringify(next));
      } catch {
        // Quota exceeded or storage unavailable (e.g. private browsing) —
        // state still updates in memory, it just won't survive navigation.
      }
      return next;
    });
  }

  return [state, setPersistedState];
}
