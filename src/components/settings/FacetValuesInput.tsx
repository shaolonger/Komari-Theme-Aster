import { useState } from 'react';

function parseValues(text: string) {
  return [...new Set(text.split(/[;；]/).map(value => value.trim()).filter(Boolean))];
}

// Keep punctuation while typing, but publish each edit immediately so dirty
// tracking and save payloads never depend on a later blur event.
export function FacetValuesInput({ label, values, onChange }: { label: string; values: string[]; onChange: (values: string[]) => void }) {
  const signature = JSON.stringify(values);
  const [buffer, setBuffer] = useState({ signature, text: values.join('; ') });
  if (buffer.signature !== signature) {
    setBuffer({ signature, text: values.join('; ') });
  }
  return <input aria-label={label} value={buffer.text} placeholder="多个值用分号分隔" onChange={event => {
    const text = event.target.value;
    const next = parseValues(text);
    setBuffer({ signature: JSON.stringify(next), text });
    onChange(next);
  }}/>;
}
