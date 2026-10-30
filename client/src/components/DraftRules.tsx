// Shared eligibility rules on the open version: each pinned to one rule version.
// State reviewers can attach a rule (at its latest version) or remove one while it is a draft.
import { useState } from 'react';
import type { FormEvent } from 'react';
import * as api from '../api.ts';
import { useApp } from '../context.ts';
import { ruleCondition } from '../format.ts';
import { useAction } from '../hooks.ts';
import type { RuleSummary, SchemeVersion } from '../types.ts';
import { Alert, Empty, Needs } from './ui.tsx';

type Props = {
  schemeRef: string;
  draft: SchemeVersion;
  rules: RuleSummary[];
  editable: boolean;
  onChanged: (message?: string) => void;
};

export function DraftRules({ schemeRef, draft, rules, editable, onChanged }: Props) {
  const { user } = useApp();
  // One status line for attach and remove, so only the latest result is shown.
  const action = useAction();
  const codes = Object.keys(draft.rules);

  async function handleRemove(code: string) {
    if (!user) return;
    const ok = await action.run(() => api.removeRule(user.id, schemeRef, code), `Removed ${code} from this draft.`);
    if (ok) onChanged();
  }

  return (
    <>
      <h3>Eligibility rules (all must hold)</h3>
      {codes.length === 0 ? (
        <Empty>No rules attached.</Empty>
      ) : (
        <ul className="rule-list">
          {codes.map((code) => {
            const pinned = draft.rules[code];
            const versions = rules.find((r) => r.code === code)?.versions ?? [];
            const rule = versions.find((v) => v.version_no === pinned);
            const latest = versions.at(-1);
            return (
              <li key={code} className="rule-row">
                <div>
                  <strong>
                    {code} v{pinned}
                  </strong>
                  {rule && (
                    <>
                      : {rule.description} <code>({ruleCondition(rule)})</code>
                    </>
                  )}
                  {latest && latest.version_no > pinned && (
                    <p className="warn-text">A newer version exists (v{latest.version_no}). Attach the rule again to move to it.</p>
                  )}
                </div>
                {editable && (
                  <button type="button" className="btn btn-small btn-danger" onClick={() => handleRemove(code)} disabled={action.busy}>
                    Remove rule
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {editable && <AttachRule schemeRef={schemeRef} draft={draft} rules={rules} action={action} onChanged={onChanged} />}
      <Alert error={action.error} success={action.done} />
    </>
  );
}

type AttachProps = Omit<Props, 'editable'> & { action: ReturnType<typeof useAction> };

function AttachRule({ schemeRef, draft, rules, action, onChanged }: AttachProps) {
  const { user } = useApp();
  const [code, setCode] = useState('');

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!user || !code) return;
    const v = await action.run(
      () => api.attachRule(user.id, schemeRef, code),
      (result) => `${code} is attached at v${result.rules[code]}.`,
    );
    if (v) onChanged();
  }

  return (
    <form className="form form-inline" onSubmit={handleSubmit}>
      <label>
        <span>
          Attach a shared rule <Needs role="STATE_REVIEWER" />
        </span>
        <select value={code} onChange={(e) => setCode(e.target.value)} required>
          <option value="">Choose a rule…</option>
          {rules.map((r) => {
            const latest = r.versions.at(-1);
            const pinned = draft.rules[r.code];
            const label =
              `${r.code} (latest v${latest?.version_no ?? '?'})` +
              (pinned ? `, attached at v${pinned}` : '') +
              (latest ? ` — ${latest.description}` : '');
            return (
              <option key={r.code} value={r.code}>
                {label}
              </option>
            );
          })}
        </select>
      </label>
      <button type="submit" className="btn" disabled={action.busy || !code}>
        {action.busy ? 'Working…' : 'Attach rule'}
      </button>
    </form>
  );
}
