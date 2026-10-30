// The open version of a scheme. State reviewers edit, submit or discard it here,
// or start a new draft when only the published version exists.
import * as api from '../api.ts';
import { hasRole, shortName, useApp } from '../context.ts';
import { formatWhen } from '../format.ts';
import { useAction } from '../hooks.ts';
import type { RuleSummary, SchemeVersion, WorkflowEvent } from '../types.ts';
import { DraftRules } from './DraftRules.tsx';
import { FieldEditor } from './FieldEditor.tsx';
import { FieldList } from './FieldView.tsx';
import { Alert, Badge, Needs, Note, Section } from './ui.tsx';

type Props = {
  schemeRef: string;
  open: SchemeVersion | null;
  live: SchemeVersion | null;
  rules: RuleSummary[];
  events: WorkflowEvent[];
  onChanged: (message?: string) => void;
};

export function DraftPanel({ schemeRef, open, live, rules, events, onChanged }: Props) {
  const { user, users } = useApp();
  const isState = hasRole(user, 'STATE_REVIEWER');

  if (!open) return <NoDraft schemeRef={schemeRef} live={live} onChanged={onChanged} />;

  const editable = open.status === 'draft' && isState;
  // If the last thing that happened to this version was a send-back, show the comment so the editor knows what to fix.
  const last = events.filter((e) => e.version_no === open.version_no).at(-1);
  const sentBack = open.status === 'draft' && last?.action === 'sent_back' ? last : null;

  return (
    <Section
      title={
        <>
          Open version v{open.version_no} <Badge status={open.status} />
        </>
      }
      extra={open.status === 'draft' ? <Needs role="STATE_REVIEWER" /> : undefined}
    >
      <p className="meta-line">
        Revision {open.revision} · started {formatWhen(open.created_at)} by {shortName(users, open.created_by)}
        {open.based_on ? ` · copied from v${open.based_on}` : ' · new scheme'}
      </p>

      {sentBack && (
        <div className="alert alert-warn" role="status">
          <p>
            Sent back by {shortName(users, sentBack.by)} on {formatWhen(sentBack.at)}:
          </p>
          <p className="quote">{sentBack.comment}</p>
        </div>
      )}

      {open.status === 'in_review' && (
        <Note>In review: nobody can edit it until a Central reviewer approves it or sends it back with a comment.</Note>
      )}
      {open.status === 'draft' && !isState && <Note>Only State reviewers can edit this draft. Pick one in "Acting as".</Note>}

      <h3>Fields</h3>
      <FieldList records={Object.values(open.fields)} />

      <DraftRules schemeRef={schemeRef} draft={open} rules={rules} editable={editable} onChanged={onChanged} />

      {editable && (
        <>
          <FieldEditor key={open.version_no} schemeRef={schemeRef} draft={open} onChanged={onChanged} />
          <DraftActions schemeRef={schemeRef} draft={open} onChanged={onChanged} />
        </>
      )}
    </Section>
  );
}

// No open draft: offer to start one from the published version.
function NoDraft({ schemeRef, live, onChanged }: { schemeRef: string; live: SchemeVersion | null; onChanged: (m?: string) => void }) {
  const { user } = useApp();
  const start = useAction();

  async function handleStart() {
    if (!user) return;
    const v = await start.run(() => api.startDraft(user.id, schemeRef));
    if (v) onChanged(`Started draft v${v.version_no}, copied from the published version. Agents still see v${v.based_on}.`);
  }

  return (
    <Section title="Open draft" extra={<Needs role="STATE_REVIEWER" />}>
      {live ? (
        <>
          <Note>No open draft. Agents see v{live.version_no}. Starting a draft copies it; the published version stays as it is.</Note>
          {hasRole(user, 'STATE_REVIEWER') ? (
            <button type="button" className="btn btn-primary" onClick={handleStart} disabled={start.busy}>
              {start.busy ? 'Starting…' : 'Start new draft'}
            </button>
          ) : (
            <Note>Only State reviewers can start a draft.</Note>
          )}
          <Alert error={start.error} />
        </>
      ) : (
        <Note>Nothing is published and there is no open draft, so there is nothing to start from.</Note>
      )}
    </Section>
  );
}

function DraftActions({ schemeRef, draft, onChanged }: { schemeRef: string; draft: SchemeVersion; onChanged: (m?: string) => void }) {
  const { user } = useApp();
  const submit = useAction();
  const discard = useAction();

  async function handleSubmit() {
    if (!user) return;
    const v = await submit.run(() => api.submitDraft(user.id, schemeRef));
    if (v) onChanged(`v${v.version_no} was sent for review (revision ${v.revision}). A Central reviewer must approve it.`);
  }

  async function handleDiscard() {
    if (!user) return;
    if (!window.confirm(`Discard draft v${draft.version_no}? It is kept in the history but can no longer be edited.`)) return;
    const v = await discard.run(() => api.discardDraft(user.id, schemeRef));
    if (v) onChanged(`Draft v${v.version_no} was discarded.`);
  }

  return (
    <div className="subpanel">
      <h3>Finish this draft</h3>
      <div className="button-row">
        <button type="button" className="btn btn-primary" onClick={handleSubmit} disabled={submit.busy}>
          {submit.busy ? 'Submitting…' : 'Submit for review'}
        </button>
        <button type="button" className="btn btn-danger" onClick={handleDiscard} disabled={discard.busy}>
          {discard.busy ? 'Discarding…' : 'Discard draft'}
        </button>
      </div>
      <Alert error={submit.error} />
      <Alert error={discard.error} />
    </div>
  );
}
