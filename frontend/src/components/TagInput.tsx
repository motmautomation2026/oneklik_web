import { useEffect, useRef, useState, type ClipboardEvent, type KeyboardEvent } from "react";
import { Badge, Form, Spinner } from "react-bootstrap";

interface TagInputProps {
  label: string;
  values: string[];
  onChange: (values: string[]) => void;
  placeholder: string;
  // Optional — when provided, shows a live suggestions dropdown as the user
  // types (debounced). Every other usage of this component is unaffected.
  fetchSuggestions?: (query: string) => Promise<string[]>;
  // Optional — applied to every value right before it's committed (Enter,
  // blur, paste, or a clicked suggestion), so e.g. domain input can be
  // cleaned up to a bare registrable domain regardless of how it was
  // entered. Every other usage of this component is unaffected.
  normalize?: (value: string) => string;
}

const SUGGESTION_MIN_CHARS = 2;
const SUGGESTION_DEBOUNCE_MS = 300;

export default function TagInput({
  label,
  values,
  onChange,
  placeholder,
  fetchSuggestions,
  normalize,
}: TagInputProps) {
  const [input, setInput] = useState("");
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [loadingSuggestions, setLoadingSuggestions] = useState(false);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const requestIdRef = useRef(0);

  useEffect(() => {
    if (!fetchSuggestions) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);

    if (input.trim().length < SUGGESTION_MIN_CHARS) {
      setSuggestions([]);
      setLoadingSuggestions(false);
      return;
    }

    setLoadingSuggestions(true);
    const requestId = ++requestIdRef.current;
    debounceRef.current = setTimeout(async () => {
      try {
        const results = await fetchSuggestions(input.trim());
        if (requestId === requestIdRef.current) {
          setSuggestions(results.filter((s) => !values.includes(s)));
        }
      } catch {
        if (requestId === requestIdRef.current) setSuggestions([]);
      } finally {
        if (requestId === requestIdRef.current) setLoadingSuggestions(false);
      }
    }, SUGGESTION_DEBOUNCE_MS);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [input, fetchSuggestions]);

  function addValue(value: string) {
    const trimmed = normalize ? normalize(value) : value.trim();
    if (trimmed && !values.includes(trimmed)) {
      onChange([...values, trimmed]);
    }
    setInput("");
    setSuggestions([]);
    setShowSuggestions(false);
  }

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      addValue(input);
    }
    if (e.key === "Escape") {
      setShowSuggestions(false);
    }
  }

  // Pasting a whole block (one per line, or comma-separated) adds every
  // value at once instead of leaving it as one garbled entry.
  function handlePaste(e: ClipboardEvent<HTMLInputElement>) {
    const text = e.clipboardData.getData("text");
    const parts = text
      .split(/[\n,]+/)
      .map((s) => (normalize ? normalize(s) : s.trim()))
      .filter(Boolean);

    if (parts.length > 1) {
      e.preventDefault();
      const unique = parts.filter((p) => !values.includes(p));
      if (unique.length > 0) {
        onChange([...values, ...new Set(unique)]);
      }
      setInput("");
    }
  }

  const hasDropdown = fetchSuggestions && showSuggestions && (loadingSuggestions || suggestions.length > 0);

  return (
    <fieldset className="mb-3">
      <Form.Label className="fw-semibold small text-uppercase text-primary">{label}</Form.Label>
      {values.length > 0 && (
        <div className="d-flex flex-wrap gap-2 mb-2">
          {values.map((v) => (
            <Badge
              key={v}
              bg="primary"
              className="d-flex align-items-center gap-1 py-2 px-2"
              style={{ maxWidth: "100%", minWidth: 0 }}
            >
              <span className="text-truncate" style={{ maxWidth: 200 }} title={v}>
                {v}
              </span>
              <span
                role="button"
                aria-label={`Remove ${v}`}
                onClick={() => onChange(values.filter((x) => x !== v))}
                style={{ cursor: "pointer", flexShrink: 0 }}
              >
                &times;
              </span>
            </Badge>
          ))}
        </div>
      )}
      <div className="position-relative">
        <Form.Control
          size="sm"
          placeholder={placeholder}
          value={input}
          onChange={(e) => {
            setInput(e.target.value);
            setShowSuggestions(true);
          }}
          onFocus={() => setShowSuggestions(true)}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          onBlur={() => {
            // Let a suggestion's onMouseDown fire first, then close + commit.
            setTimeout(() => setShowSuggestions(false), 100);
            addValue(input);
          }}
        />
        {hasDropdown && (
          <div className="tag-suggest-dropdown">
            {loadingSuggestions ? (
              <div className="tag-suggest-item text-body-secondary d-flex align-items-center gap-2">
                <Spinner animation="border" size="sm" /> Searching…
              </div>
            ) : (
              suggestions.map((s) => (
                <div
                  key={s}
                  className="tag-suggest-item"
                  role="button"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    addValue(s);
                  }}
                >
                  {s}
                </div>
              ))
            )}
          </div>
        )}
      </div>
    </fieldset>
  );
}
