import { useEffect, useRef, useState } from "react";

interface AdminResourceState<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
}

// Six independent sections on the overview page each need their own
// loading/error state so one failing endpoint doesn't blank the rest of the
// page — this is the one hook shared across them instead of repeating the
// same fetch/loading/error boilerplate six times.
//
// The fetcher may take an AbortSignal to cancel its underlying request when
// deps change again before it resolves (e.g. fast typing in a debounced
// search box) — existing zero-arg fetchers (`() => fetchX()`) still work
// unchanged since they simply ignore the extra argument.
export function useAdminResource<T>(
  fetcher: (signal: AbortSignal) => Promise<T>,
  deps: unknown[] = [],
): AdminResourceState<T> {
  const [state, setState] = useState<AdminResourceState<T>>({ data: null, loading: true, error: null });
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    setState((prev) => ({ ...prev, loading: true, error: null }));
    fetcherRef
      .current(controller.signal)
      .then((data) => {
        if (active) setState({ data, loading: false, error: null });
      })
      .catch((err: unknown) => {
        if (active && !(err instanceof DOMException && err.name === "AbortError")) {
          setState({ data: null, loading: false, error: err instanceof Error ? err.message : "Failed to load" });
        }
      });
    return () => {
      active = false;
      controller.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return state;
}
