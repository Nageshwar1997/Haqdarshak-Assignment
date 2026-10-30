// Review flags raised when a shared rule this scheme uses gets a new version.
// The published scheme keeps its old rule version until someone reviews it.
import { useState } from 'react';
import type { FormEvent } from 'react';
import * as api from '../api.ts';
import { hasRole, shortName, useApp } from '../context.ts';
import { formatWhen, ruleCondition } from '../format.ts';
import { useAction } from '../hooks.ts';
import type { Loaded } from '../hooks.ts';
import type { ReviewFlag, RuleSummary } from '../types.ts';
import { Alert, Badge, Empty, Loading, Needs, Note, Section } from './ui.tsx';

type Props = { flags: Loaded<ReviewFlag[]>; rules: RuleSummary[]; onChanged: (message?: string) => void };

export function FlagsPanel({ flags, rules, onChanged }: Props) {
  const { users } = useApp();
  const list = flags.data ?? [];
  const open = list.filter((f) => f.status === 'open');
  const closed = list.filter((f) => f.status !== 'open');

  return (
    <Section title={`Rule-change flags (${open.length} open)`}>
      {flags.loading && !flags.data && <Loading what="Loading flags" />}
      <Alert error={flags.error} onRetry={flags.reload} />

      {flags.data && open.length === 0 && <Empty>No open flags. Every shared rule this scheme uses is up to date or was reviewed.</Empty>}
      {open.length > 0 && (
        <>
          <Note>
            Publishing is blocked until the draft uses the new rule version (a State reviewer attaches the rule again), or a Central
            reviewer dismisses the flag with a reason.
          </Note>
          <ul className="flag-list">
            {open.map((f) => (
              <OpenFlag key={f.id} flag={f} rules={rules} onChanged={onChanged} />
            ))}
          </ul>
        </>
      )}

      {closed.length > 0 && (
        <>
          <h3>Closed flags</h3>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th scope="col">Rule</th>
                  <th scope="col">Change</th>
                  <th scope="col">Status</th>
                  <th scope="col">Closed by</th>
                  <th scope="col">Reason</th>
                </tr>
              </thead>
              <tbody>
                {closed.map((f) => (
                  <tr key={f.id}>
                    <td>
                      <code>{f.rule_code}</code>
                    </td>
                    <td>
                      v{f.from_version} → v{f.to_version}
                    </td>
                    <td>
                      <Badge status={f.status} />
                    </td>
                    <td>{shortName(users, f.closed_by)}</td>
                    <td>{f.closed_note ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </Section>
  );
}

function OpenFlag({ flag, rules, onChanged }: { flag: ReviewFlag; rules: RuleSummary[]; onChanged: (message?: string) => void }) {
  const { user } = useApp();
  const versions = rules.find((r) => r.code === flag.rule_code)?.versions ?? [];
  const from = versions.find((v) => v.version_no === flag.from_version);
  const to = versions.find((v) => v.version_no === flag.to_version);

  return (
    <li className="flag">
      <p>
        <Badge status="open" /> <strong>{flag.rule_code}</strong> changed from v{flag.from_version} to v{flag.to_version}{' '}
        <span className="muted">· flagged {formatWhen(flag.created_at)}</span>
      </p>
      <dl className="rule-change">
        <dt>v{flag.from_version}</dt>
        <dd>{from ? `${from.description} (${ruleCondition(from)})` : '—'}</dd>
        <dt>v{flag.to_version}</dt>
        <dd>{to ? `${to.description} (${ruleCondition(to)})` : '—'}</dd>
      </dl>
      {hasRole(user, 'CENTRAL_REVIEWER') && <DismissForm flag={flag} onChanged={onChanged} />}
    </li>
  );
}

function DismissForm({ flag, onChanged }: { flag: ReviewFlag; onChanged: (message?: string) => void }) {
  const { user } = useApp();
  const [note, setNote] = useState('');
  const dismiss = useAction();
  const inputId = `dismiss-${flag.id}`;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!user) return;
    const f = await dismiss.run(() => api.dismissFlag(user.id, flag.id, note));
    if (f) onChanged(`Flag on ${f.rule_code} was dismissed. This scheme keeps rule v${f.from_version}.`);
  }

  return (
    <form className="form form-inline" onSubmit={handleSubmit}>
      <div className="input-group wide">
        <label htmlFor={inputId}>
          Reason to keep the old rule version (required) <Needs role="CENTRAL_REVIEWER" />
        </label>
        <textarea id={inputId} rows={2} value={note} onChange={(e) => setNote(e.target.value)} required />
      </div>
      <button type="submit" className="btn" disabled={dismiss.busy}>
        {dismiss.busy ? 'Dismissing…' : 'Dismiss flag'}
      </button>
      <Alert error={dismiss.error} />
    </form>
  );
}
