import { useEffect, useState, type KeyboardEvent, type ReactNode } from "react";
import { Form } from "react-bootstrap";

interface ClampedNumberInputProps {
  label: string;
  value: number;
  onChange: (value: number) => void;
  min: number;
  max: number;
  helpText?: ReactNode;
}

// Plain <input type="number"> clamped on every keystroke fights the user:
// clearing the field to type a new value hits Number("") === 0, which a
// naive `|| min` fallback snaps straight to the floor mid-edit. This lets
// the field hold whatever's being typed and only clamps once you're done
// (blur or Enter) — never fighting the keystroke in between.
export default function ClampedNumberInput({ label, value, onChange, min, max, helpText }: ClampedNumberInputProps) {
  const [text, setText] = useState(String(value));

  useEffect(() => {
    setText(String(value));
  }, [value]);

  function commit() {
    const parsed = Number(text);
    const clamped = Math.min(max, Math.max(min, Number.isFinite(parsed) && text !== "" ? parsed : min));
    setText(String(clamped));
    if (clamped !== value) onChange(clamped);
  }

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      commit();
    }
  }

  const parsed = Number(text);
  const isOutOfRange = text !== "" && Number.isFinite(parsed) && (parsed < min || parsed > max);
  const previewClamped = Math.min(max, Math.max(min, Number.isFinite(parsed) ? parsed : min));

  return (
    <Form.Group className="mb-3">
      <Form.Label className="fw-semibold small text-uppercase text-primary">{label}</Form.Label>
      <Form.Control
        size="sm"
        type="number"
        min={min}
        max={max}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={handleKeyDown}
        className={isOutOfRange ? "border-warning" : undefined}
      />
      {isOutOfRange ? (
        <Form.Text className="text-warning">
          Must be between {min} and {max} — will be set to {previewClamped} when you leave this field.
        </Form.Text>
      ) : (
        helpText && <Form.Text>{helpText}</Form.Text>
      )}
    </Form.Group>
  );
}
