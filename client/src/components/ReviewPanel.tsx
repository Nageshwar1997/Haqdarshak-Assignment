// Central reviewer: compare the version in review with what agents see now, then approve or send back.
import { useState } from 'react';
import type { FormEvent } from 'react';
import * as api from '../api.ts';
import { fieldLabel, shortName, useApp } from '../context.ts';
import { useAction, useLoad } from '../hooks.ts';
import type { SchemeVersion } from '../types.ts';
import { EvidenceView, Value } from './FieldView.tsx';
import { Alert, Empty, Loading, Needs, Section } from './ui.tsx';

type Props = { schemeRef: string; version: SchemeVersion; refreshKey: number; onChanged: (message?: string) => void };

export function ReviewPanel({ schemeRef, version, refreshKey, onChanged }: Props) {
  const { user, users, fields } = useApp();
  const diff = useLoad(() => api.getDiff(schemeRef), [schemeRef, refreshKey]);
  const approve = useAction();
  const d = diff.data;
  // Shown, not hidden: the server refuses, and the reviewer sees the four-eyes rule at work.
  const ownWork = !!user && version.editors.includes(user.id);

  async function handleApprove() {
    if (!user) return;
    // Send the revision shown on this page. If the draft changed since, the server refuses.
    const v = await approve.run(() => api.publish(user.id, schemeRef, version.revision));
    if (v) onChanged(`Published v${v.version_no}. Agents now see this version.`);
  }

  // Fetch the latest version and diff again, so the reviewer can look before approving.
  function reload() {
    approve.clear();
    onChanged();
  }

  return (
    <Section title={`Review v${version.version_no}`} extra={<Needs role="CENTRAL_REVIEWER" />}>
      <p className="meta-line">
        You are reviewing revision {version.revision}, prepared by {version.editors.map((id) => shortName(users, id)).join(', ')}.
        {d && (d.published_version ? ` Compared with published v${d.published_version}.` : ' Nothing is published yet, so everything is new.')}
      </p>

      {diff.loading && !d && <Loading what="Loading changes" />}
      <Alert error={diff.error} onRetry={diff.reload} />

      {d && (
        <>
          <h3>Field changes</h3>
          {d.fields.length === 0 ? (
            <Empty>No field changes.</Empty>
          ) : (
            <div className="table-wrap">
              <table className="diff">
                <thead>
                  <tr>
                    <th scope="col">Field</th>
                    <th scope="col">Before (published)</th>
                    <th scope="col">After (this version)</th>
                    <th scope="col">Source of the new value</th>
                  </tr>
                </thead>
                <tbody>
                  {d.fields.map((f) => (
                    <tr key={f.field}>
                      <th scope="row">{fieldLabel(fields, f.field)}</th>
                      <td className="before">
                        <Value value={f.before} field={f.field} />
                      </td>
                      <td className="after">
                        <Value value={f.after} field={f.field} />
                      </td>
                      <td>{f.source ? <EvidenceView evidence={f.source} /> : <span className="value-empty">none (not found or conflict)</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <h3>Rule version changes</h3>
          {d.rules.length === 0 ? (
            <Empty>No rule changes.</Empty>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th scope="col">Rule</th>
                    <th scope="col">Before</th>
                    <th scope="col">After</th>
                  </tr>
                </thead>
                <tbody>
                  {d.rules.map((r) => (
                    <tr key={r.rule}>
                      <th scope="row">
                        <code>{r.rule}</code>
                      </th>
                      <td className="before">{r.before === null ? 'not attached' : `v${r.before}`}</td>
                      <td className="after">{r.after === null ? 'removed' : `v${r.after}`}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      <div className="subpanel">
        <h3>Approve and publish</h3>
        <p className="hint">Approves revision {version.revision} exactly as shown above. If it changes meanwhile, the server refuses.</p>
        {ownWork && (
          <p className="warn-text">
            You created or edited this version. Nobody may approve their own work, so the server will refuse; it is shown so you can see the rule.
          </p>
        )}
        <div className="button-row">
          <button type="button" className="btn btn-primary" onClick={handleApprove} disabled={approve.busy}>
            {approve.busy ? 'Publishing…' : 'Approve and publish'}
          </button>
        </div>
        {/* A 409 often means the draft changed since this page loaded: offer a reload. */}
        <Alert error={approve.error} onRetry={approve.error?.status === 409 ? reload : undefined} />
      </div>

      <SendBack schemeRef={schemeRef} onChanged={onChanged} />
    </Section>
  );
}

function SendBack({ schemeRef, onChanged }: { schemeRef: string; onChanged: (message?: string) => void }) {
  const { user } = useApp();
  const [comment, setComment] = useState('');
  const send = useAction();

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!user) return;
    const v = await send.run(() => api.sendBack(user.id, schemeRef, comment));
    if (v) onChanged(`v${v.version_no} was sent back to the State reviewer with your comment.`);
  }

  return (
    <form className="subpanel form" onSubmit={handleSubmit}>
      <h3>Send back</h3>
      <div className="input-group wide">
        <label htmlFor="send-back-comment">What should be fixed? (required)</label>
        <textarea id="send-back-comment" rows={3} value={comment} onChange={(e) => setComment(e.target.value)} required />
      </div>
      <div className="button-row">
        <button type="submit" className="btn" disabled={send.busy}>
          {send.busy ? 'Sending…' : 'Send back'}
        </button>
      </div>
      <Alert error={send.error} />
    </form>
  );
}
