// Edit one field of the open draft. Every value needs a source; "not found" needs a reason;
// "conflict" keeps two or more values, each with its own source.
import { useId, useState } from 'react';
import type { FormEvent } from 'react';
import * as api from '../api.ts';
import { fieldLabel, useApp } from '../context.ts';
import { fromInputText, toInputText, today, typeOf } from '../format.ts';
import { useAction } from '../hooks.ts';
import type { Evidence, FieldInput, FieldMeta, FieldRecord, FieldStatus, FieldType, SchemeVersion } from '../types.ts';
import { EvidenceInputs, ValueInput } from './Inputs.tsx';
import { Alert, Needs } from './ui.tsx';

type CandidateForm = { value: string; evidence: Evidence };

// Everything in the form is text; it is turned into typed values only when saving.
type EditorForm = {
  field: string;
  status: FieldStatus;
  value: string;
  evidence: Evidence;
  confidence: string;
  note: string;
  candidates: CandidateForm[];
};

const blankEvidence = (): Evidence => ({ text: '', location: '', source_ref: '', captured_at: today() });
const blankCandidate = (): CandidateForm => ({ value: '', evidence: blankEvidence() });

// Start the form from what the draft already has for this field, so editing is easy.
function formFor(field: string, record: FieldRecord | undefined, type: FieldType): EditorForm {
  if (!record) {
    return { field, status: 'found', value: '', evidence: blankEvidence(), confidence: '0.9', note: '', candidates: [blankCandidate(), blankCandidate()] };
  }
  const candidates = (record.candidates ?? []).map((c) => ({ value: toInputText(c.value, type), evidence: { ...c.evidence } }));
  while (candidates.length < 2) candidates.push(blankCandidate());
  return {
    field,
    status: record.status,
    value: toInputText(record.value, type),
    evidence: record.evidence ? { ...record.evidence } : blankEvidence(),
    confidence: record.confidence === null ? '0.9' : String(record.confidence),
    note: record.note ?? '',
    candidates,
  };
}

// Build the request body for PUT /api/schemes/:ref/draft/fields
function toInput(form: EditorForm, type: FieldType): FieldInput {
  const note = form.note.trim();
  const base = { field: form.field, value: null, evidence: null, confidence: null };
  if (form.status === 'found') {
    const confidence = form.confidence.trim() === '' ? null : Number(form.confidence);
    return {
      ...base,
      status: 'found',
      value: fromInputText(form.value, type),
      evidence: form.evidence,
      confidence: confidence !== null && Number.isFinite(confidence) ? confidence : null,
      ...(note ? { note } : {}),
    };
  }
  if (form.status === 'not_found') return { ...base, status: 'not_found', note: form.note };
  return {
    ...base,
    status: 'conflict',
    candidates: form.candidates.map((c) => ({ value: fromInputText(c.value, type), evidence: c.evidence })),
    ...(note ? { note } : {}),
  };
}

const STATUS_HELP: Record<FieldStatus, string> = {
  found: 'The source states this value.',
  not_found: 'The source does not give it. The value stays empty; say why.',
  conflict: 'Sources disagree. Keep every value with its source. A Central reviewer cannot publish until one is picked.',
};

type Props = { schemeRef: string; draft: SchemeVersion; onChanged: (message?: string) => void };

export function FieldEditor({ schemeRef, draft, onChanged }: Props) {
  const { user, fields } = useApp();
  const id = useId();
  const firstField = fields[0]?.name ?? 'name';
  const [form, setForm] = useState<EditorForm>(() => formFor(firstField, draft.fields[firstField], typeOf(fields, firstField)));
  const save = useAction();

  const meta: FieldMeta | undefined = fields.find((f) => f.name === form.field);
  const type = typeOf(fields, form.field);
  const update = (patch: Partial<EditorForm>) => setForm((f) => ({ ...f, ...patch }));

  function pickField(name: string) {
    save.clear();
    setForm(formFor(name, draft.fields[name], typeOf(fields, name)));
  }

  function setCandidate(i: number, patch: Partial<CandidateForm>) {
    update({ candidates: form.candidates.map((c, j) => (j === i ? { ...c, ...patch } : c)) });
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!user) return;
    const saved = await save.run(
      () => api.setField(user.id, schemeRef, toInput(form, type)),
      (r) => `Saved ${fieldLabel(fields, r.field)} as ${r.status.replace('_', ' ')}.`,
    );
    if (saved) onChanged();
  }

  if (fields.length === 0) {
    return <p className="note">The field list (GET /api/meta) has not loaded, so fields cannot be edited yet.</p>;
  }

  return (
    <form className="subpanel form" onSubmit={handleSubmit}>
      <h3>
        Edit a field <Needs role="STATE_REVIEWER" />
      </h3>

      <div className="form-grid">
        <div className="input-group">
          <label htmlFor={`${id}-field`}>Field</label>
          <select id={`${id}-field`} value={form.field} onChange={(e) => pickField(e.target.value)}>
            {fields.map((f) => (
              <option key={f.name} value={f.name}>
                {`${f.label} (${draft.fields[f.name]?.status.replace('_', ' ') ?? 'empty'})`}
              </option>
            ))}
          </select>
        </div>

        <fieldset className="radio-row">
          <legend>Status</legend>
          {(['found', 'not_found', 'conflict'] as FieldStatus[]).map((s) => (
            <label key={s} className="radio">
              <input type="radio" name={`${id}-status`} value={s} checked={form.status === s} onChange={() => update({ status: s })} />
              {s.replace('_', ' ')}
            </label>
          ))}
          <small className="hint">{STATUS_HELP[form.status]}</small>
        </fieldset>
      </div>

      {form.status === 'found' && (
        <>
          <div className="form-grid">
            <ValueInput meta={meta} value={form.value} onChange={(value) => update({ value })} />
            <div className="input-group">
              <label htmlFor={`${id}-conf`}>Confidence (0 to 1)</label>
              <input
                id={`${id}-conf`}
                type="number"
                min={0}
                max={1}
                step={0.05}
                value={form.confidence}
                onChange={(e) => update({ confidence: e.target.value })}
                required
              />
            </div>
          </div>
          <EvidenceInputs evidence={form.evidence} onChange={(evidence) => update({ evidence })} />
        </>
      )}

      {form.status === 'conflict' && (
        <div className="candidates-editor">
          {form.candidates.map((c, i) => (
            <div key={i} className="candidate">
              <div className="candidate-head">
                <strong>Candidate {i + 1}</strong>
                <button
                  type="button"
                  className="btn btn-small btn-quiet"
                  onClick={() => update({ candidates: form.candidates.filter((_, j) => j !== i) })}
                  disabled={form.candidates.length <= 2}
                  title={form.candidates.length <= 2 ? 'A conflict needs at least two candidates' : undefined}
                >
                  Remove candidate
                </button>
              </div>
              <ValueInput meta={meta} value={c.value} onChange={(value) => setCandidate(i, { value })} label={`Value ${i + 1}`} />
              <EvidenceInputs evidence={c.evidence} onChange={(evidence) => setCandidate(i, { evidence })} legend={`Source of value ${i + 1}`} />
            </div>
          ))}
          <button type="button" className="btn btn-small" onClick={() => update({ candidates: [...form.candidates, blankCandidate()] })}>
            Add candidate
          </button>
        </div>
      )}

      <div className="input-group wide">
        <label htmlFor={`${id}-note`}>{form.status === 'not_found' ? 'Why was it not found? (required)' : 'Note (optional)'}</label>
        <textarea
          id={`${id}-note`}
          rows={2}
          value={form.note}
          onChange={(e) => update({ note: e.target.value })}
          required={form.status === 'not_found'}
        />
      </div>

      <div className="button-row">
        <button type="submit" className="btn btn-primary" disabled={save.busy}>
          {save.busy ? 'Saving…' : 'Save field'}
        </button>
      </div>
      <Alert error={save.error} success={save.done} />
    </form>
  );
}
