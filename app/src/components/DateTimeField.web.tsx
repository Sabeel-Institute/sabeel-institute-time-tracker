// Web side of the date/time input seam (native sibling: DateTimeField.tsx).
// Uses the browser's native <input type="date|time"> pickers; value stays the
// screens' string format (dayKey / 'HH:MM'), which matches the input's own.
import { getTheme } from '../theme';

const t = getTheme();

const inputStyle: React.CSSProperties = {
  borderWidth: 1,
  borderStyle: 'solid',
  borderColor: t.border.subtle,
  borderRadius: 8,
  padding: '10px 12px',
  minHeight: 44,
  fontSize: 15,
  color: t.text.primary,
  fontFamily: 'inherit',
  // The look of every text box in the app (ui.tsx `input`).
  backgroundColor: t.bg.inset,
  colorScheme: 'light',
  // Hug the current date/time rather than reserve width for the widest possible
  // value — a native date input otherwise sits in an oversized box, stretched on
  // a desktop. Capped at the column; progressive enhancement (no-ops on older
  // engines, which fall back to the default sizing).
  fieldSizing: 'content',
  maxWidth: '100%',
  boxSizing: 'border-box',
};

export function DateTimeField({
  kind,
  value,
  onChange,
}: {
  kind: 'date' | 'time';
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <input
      type={kind}
      value={value}
      onChange={(e) => onChange(e.currentTarget.value)}
      style={inputStyle}
    />
  );
}
