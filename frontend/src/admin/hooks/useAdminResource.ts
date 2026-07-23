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
export function useAdminResource<T>(fetcher: () => Promise<T>, deps: unknown[] = []): AdminResourceState<T> {
  const [state, setState] = useState<AdminResourceState<T>>({ data: null, loading: true, error: null });
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  useEffect(() => {
    let active = true;
    setState((prev) => ({ ...prev, loading: true, error: null }));
    fetcherRef
      .current()
      .then((data) => {
        if (active) setState({ data, loading: false, error: null });
      })
      .catch((err: unknown) => {
        if (active) setState({ data: null, loading: false, error: err instanceof Error ? err.message : "Failed to load" });
      });
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return state;
}
