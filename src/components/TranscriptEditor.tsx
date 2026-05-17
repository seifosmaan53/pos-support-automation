export function TranscriptEditor({
  value,
  onChange,
  placeholder,
  rows = 10,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  rows?: number;
}) {
  return (
    <textarea
      className="input font-mono text-sm leading-relaxed"
      rows={rows}
      placeholder={placeholder}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}
