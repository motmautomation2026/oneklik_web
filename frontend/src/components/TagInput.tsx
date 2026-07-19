import { useState, type ClipboardEvent, type KeyboardEvent } from "react";
import { Badge, Form } from "react-bootstrap";

interface TagInputProps {
  label: string;
  values: string[];
  onChange: (values: string[]) => void;
  placeholder: string;
}

export default function TagInput({ label, values, onChange, placeholder }: TagInputProps) {
  const [input, setInput] = useState("");

  function add() {
    const value = input.trim();
    if (value && !values.includes(value)) {
      onChange([...values, value]);
    }
    setInput("");
  }

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      add();
    }
  }

  // Pasting a whole block (one per line, or comma-separated) adds every
  // value at once instead of leaving it as one garbled entry.
  function handlePaste(e: ClipboardEvent<HTMLInputElement>) {
    const text = e.clipboardData.getData("text");
    const parts = text
      .split(/[\n,]+/)
      .map((s) => s.trim())
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
      <Form.Control
        size="sm"
        placeholder={placeholder}
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={handleKeyDown}
        onPaste={handlePaste}
        onBlur={add}
      />
    </fieldset>
  );
}
