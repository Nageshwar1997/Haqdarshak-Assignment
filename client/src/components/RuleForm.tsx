// Form for a new shared rule or a new version of one: one condition (concept, operator, value) plus its source.
import { useId, useState } from 'react';
import type { FormEvent } from 'react';
import { ApiError } from '../api.ts';
import { useApp } from '../context.ts';
import { today } from '../format.ts';
import { useAction } from '../hooks.ts';
import type { Evidence, RuleInput, RuleVersion } from '../types.ts';
import { EvidenceInputs } from './Inputs.tsx';
import { Alert } from './ui.tsx';

type Props = {
  initial?: RuleVersion; // when changing a rule, start from its latest version
  withCode?: boolean; // a new rule also needs a code
  submitLabel: string;
  onSave: (userId: string, input: RuleInput, code: string) => Promise<void>;
  onCancel?: () => void;
};

export function RuleForm({ initial, withCode, submitLabel, onSave, onCancel }: Props) {
  const { user } = useApp();
  const id = useId();
  const [code, setCode] = useState('');
  const [concept, setConcept] = useState(initial?.concept ?? '');
  const [operator, setOperator] = useState(initial?.operator ?? '');
  // The value is typed as JSON, so it can be a number, text or a list.
  const [valueText, setValueText] = useState(initial ? JSON.stringify(initial.value) : '');
  const [description, setDescription] = useState(initial?.description ?? '');
  // A changed rule needs its own new source, so the evidence starts empty.
  const [evidence, setEvidence] = useState<Evidence>({ text: '', location: '', source_ref: '', captured_at: today() });
  const save = useAction();

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!user) return;
    let value: unknown;
    try {
      value = JSON.parse(valueText);
    } catch {
      // Checked here, before sending, because the server only ever receives parsed JSON.
      save.setError(new ApiError(0, 'INVALID', 'Value must be valid JSON, for example 250000, "MH" or ["SC", "ST"].'));
      return;
    }
    await save.run(() => onSave(user.id, { concept, operator, value, description, evidence }, code.trim()));
  }

  return (
    <form className="form" onSubmit={handleSubmit}>
      <div className="form-grid">
        {withCode && (
          <div className="input-group">
            <label htmlFor={`${id}-code`}>Code</label>
            <input id={`${id}-code`} value={code} onChange={(e) => setCode(e.target.value)} placeholder="e.g. WIDOW" required />
          </div>
        )}
        <div className="input-group">
          <label htmlFor={`${id}-concept`}>Concept</label>
          <input id={`${id}-concept`} value={concept} onChange={(e) => setConcept(e.target.value)} placeholder="e.g. annual_family_income" required />
        </div>
        <div className="input-group">
          <label htmlFor={`${id}-op`}>Operator</label>
          <input id={`${id}-op`} value={operator} onChange={(e) => setOperator(e.target.value)} placeholder="<, <=, =, >=, in" required />
        </div>
        <div className="input-group">
          <label htmlFor={`${id}-value`}>Value (JSON)</label>
          <input id={`${id}-value`} value={valueText} onChange={(e) => setValueText(e.target.value)} placeholder='250000 or "MH" or ["SC","ST"]' required />
        </div>
      </div>
      <div className="input-group wide">
        <label htmlFor={`${id}-desc`}>Description (shown to agents)</label>
        <input id={`${id}-desc`} value={description} onChange={(e) => setDescription(e.target.value)} required />
      </div>
      <EvidenceInputs evidence={evidence} onChange={setEvidence} legend="Source of this rule" />
      <div className="button-row">
        <button type="submit" className="btn btn-primary" disabled={save.busy}>
          {save.busy ? 'Saving…' : submitLabel}
        </button>
        {onCancel && (
          <button type="button" className="btn btn-quiet" onClick={onCancel}>
            Cancel
          </button>
        )}
      </div>
      <Alert error={save.error} />
    </form>
  );
}
