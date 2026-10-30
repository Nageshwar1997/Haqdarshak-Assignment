// How one field is shown: value, status, confidence, and its source right under it.
import { fieldLabel, useApp } from '../context.ts';
import { formatValue, isEmpty } from '../format.ts';
import type { Evidence, FieldRecord } from '../types.ts';
import { Badge } from './ui.tsx';

export function EvidenceView({ evidence }: { evidence: Evidence | null }) {
  if (!evidence) return <p className="evidence evidence-missing">No source recorded.</p>;
  return (
    <div className="evidence">
      <q>{evidence.text}</q>
      <span className="evidence-meta">
        {evidence.location} · {evidence.source_ref} · captured {evidence.captured_at}
      </span>
    </div>
  );
}

// Lists are shown as bullet points, everything else as one line of text.
export function Value({ value, field }: { value: unknown; field?: string }) {
  if (Array.isArray(value) && value.length > 0) {
    return (
      <ul className="value-list">
        {value.map((v, i) => (
          <li key={i}>{formatValue(v, field)}</li>
        ))}
      </ul>
    );
  }
  return <span className={isEmpty(value) ? 'value-empty' : 'value'}>{formatValue(value, field)}</span>;
}

export function FieldView({ record }: { record: FieldRecord }) {
  const { fields } = useApp();
  return (
    <li className="field">
      <div className="field-head">
        <span className="field-label">{fieldLabel(fields, record.field)}</span>
        <Badge status={record.status} />
        {record.confidence !== null && <span className="confidence">confidence {record.confidence}</span>}
      </div>

      {record.status === 'found' && (
        <>
          <Value value={record.value} field={record.field} />
          <EvidenceView evidence={record.evidence} />
        </>
      )}

      {record.status === 'not_found' && <p className="value-empty">Not found{record.note ? `: ${record.note}` : ''}</p>}

      {record.status === 'conflict' && (
        <div className="candidates">
          <p className="value-empty">Sources disagree. Every value is kept with its source:</p>
          <ol>
            {(record.candidates ?? []).map((c, i) => (
              <li key={i}>
                <Value value={c.value} field={record.field} />
                <EvidenceView evidence={c.evidence} />
              </li>
            ))}
          </ol>
        </div>
      )}

      {record.status !== 'not_found' && record.note && <p className="field-note">Note: {record.note}</p>}
    </li>
  );
}

// Fields in catalogue order (name first), then any the catalogue does not know.
export function FieldList({ records }: { records: FieldRecord[] }) {
  const { fields } = useApp();
  if (records.length === 0) return <p className="empty">No fields yet.</p>;
  const order = (name: string) => {
    const i = fields.findIndex((f) => f.name === name);
    return i === -1 ? fields.length : i;
  };
  const sorted = [...records].sort((a, b) => order(a.field) - order(b.field));
  return (
    <ul className="field-list">
      {sorted.map((r) => (
        <FieldView key={r.field} record={r} />
      ))}
    </ul>
  );
}
