// Form inputs shared by the field editor and the rule forms.
import { useId } from 'react';
import type { Evidence, FieldMeta } from '../types.ts';

// The right input for a field's type. The value is always kept as text and converted on save.
export function ValueInput({ meta, value, onChange, label = 'Value' }: { meta: FieldMeta | undefined; value: string; onChange: (v: string) => void; label?: string }) {
  const id = useId();
  const type = meta?.type ?? 'text';

  let input;
  if (type === 'enum') {
    input = (
      <select id={id} value={value} onChange={(e) => onChange(e.target.value)} required>
        <option value="">Choose…</option>
        {(meta?.options ?? []).map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    );
  } else if (type === 'text_list') {
    input = <textarea id={id} rows={4} value={value} onChange={(e) => onChange(e.target.value)} required />;
  } else if (type === 'number' || type === 'integer') {
    input = (
      <input
        id={id}
        type="number"
        inputMode={type === 'integer' ? 'numeric' : 'decimal'}
        min={type === 'integer' ? 1 : 0}
        step={type === 'integer' ? 1 : 'any'}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        required
      />
    );
  } else if (type === 'date') {
    input = <input id={id} type="date" value={value} onChange={(e) => onChange(e.target.value)} required />;
  } else {
    input = <input id={id} type="text" value={value} onChange={(e) => onChange(e.target.value)} required />;
  }

  const hint = {
    text: null,
    number: meta?.name === 'benefit_amount' ? 'In rupees (INR), 0 or more.' : '0 or more.',
    integer: 'A whole number above 0.',
    enum: null,
    date: 'YYYY-MM-DD',
    text_list: 'One item per line.',
  }[type];

  return (
    <div className="input-group">
      <label htmlFor={id}>{label}</label>
      {input}
      {hint && <small className="hint">{hint}</small>}
    </div>
  );
}

// The four parts of a source. Every fact must point back to one.
export function EvidenceInputs({ evidence, onChange, legend = 'Source' }: { evidence: Evidence; onChange: (e: Evidence) => void; legend?: string }) {
  const id = useId();
  const set = (key: keyof Evidence, v: string) => onChange({ ...evidence, [key]: v });

  return (
    <fieldset className="evidence-inputs">
      <legend>{legend}</legend>
      <div className="input-group wide">
        <label htmlFor={`${id}-text`}>Exact text from the source</label>
        <textarea id={`${id}-text`} rows={2} value={evidence.text} onChange={(e) => set('text', e.target.value)} required />
      </div>
      <div className="input-group">
        <label htmlFor={`${id}-loc`}>Location (page or section)</label>
        <input id={`${id}-loc`} value={evidence.location} onChange={(e) => set('location', e.target.value)} required />
      </div>
      <div className="input-group">
        <label htmlFor={`${id}-ref`}>Source reference (link or name)</label>
        <input id={`${id}-ref`} value={evidence.source_ref} onChange={(e) => set('source_ref', e.target.value)} required />
      </div>
      <div className="input-group">
        <label htmlFor={`${id}-date`}>Captured on</label>
        <input id={`${id}-date`} type="date" value={evidence.captured_at} onChange={(e) => set('captured_at', e.target.value)} required />
      </div>
    </fieldset>
  );
}
