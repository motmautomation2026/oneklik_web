import { useEffect, useState } from "react";

// Search inputs on Users/Transactions hit the backend (which itself does a
// bounded scan for email search — see backend/src/admin/queries.ts) so
// debouncing is not just UX polish here, it avoids firing that scan once per
// keystroke.
export function useDebouncedValue<T>(value: T, delayMs = 350): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);

  return debounced;
}
