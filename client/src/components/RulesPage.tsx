// Shared eligibility rules. Each change adds a rule version; schemes keep the version they were approved with.
import { useState } from 'react';
import * as api from '../api.ts';
import { hasRole, shortName, useApp } from '../context.ts';
import { formatWhen, ruleCondition } from '../format.ts';
import { hrefFor, useLoad } from '../hooks.ts';
import type { RuleSummary } from '../types.ts';
import { EvidenceView } from './FieldView.tsx';
import { RuleForm } from './RuleForm.tsx';
import { Alert, Empty, Loading, Needs, Note, Section } from './ui.tsx';

export function RulesPage() {
  const { user } = useApp();
  const rules = useLoad(api.listRules, []);
  const isCentral = hasRole(user, 'CENTRAL_REVIEWER');

  return (
    <>
      <Note>
        Changing a rule adds a new version. Published schemes keep the version they were approved with, and every scheme using the
        rule gets a review flag.
      </Note>
      {rules.loading && !rules.data && <Loading what="Loading rules" />}
      <Alert error={rules.error} onRetry={rules.reload} />
      {rules.data && rules.data.length === 0 && <Empty>No shared rules yet.</Empty>}
      {rules.data?.map((r) => (
        <RuleCard key={r.code} rule={r} canChange={isCentral} onChanged={rules.reload} />
      ))}

      <Section title="New rule" extra={<Needs role="CENTRAL_REVIEWER" />}>
        {isCentral ? (
          <NewRule onChanged={rules.reload} />
        ) : (
          <Note>Only Central reviewers can create or change shared rules, because one change affects schemes in many states.</Note>
        )}
      </Section>
    </>
  );
}

function RuleCard({ rule, canChange, onChanged }: { rule: RuleSummary; canChange: boolean; onChanged: () => void }) {
  const { users } = useApp();
  const [editing, setEditing] = useState(false);
  const [flagged, setFlagged] = useState<{ version: number; refs: string[] } | null>(null);
  const latest = rule.versions.at(-1);

  return (
    <Section
      title={
        <>
          <code>{rule.code}</code> <span className="muted">latest v{latest?.version_no}</span>
        </>
      }
      extra={
        canChange && !editing ? (
          <button type="button" className="btn btn-small" onClick={() => setEditing(true)} aria-label={`Change rule ${rule.code}`}>
            Change rule
          </button>
        ) : undefined
      }
    >
      {latest && <p>{latest.description}</p>}

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th scope="col">Version</th>
              <th scope="col">Condition</th>
              <th scope="col">Description and source</th>
              <th scope="col">Changed</th>
            </tr>
          </thead>
          <tbody>
            {rule.versions.map((v) => (
              <tr key={v.version_no}>
                <td>v{v.version_no}</td>
                <td>
                  <code>{ruleCondition(v)}</code>
                </td>
                <td>
                  {v.description}
                  <EvidenceView evidence={v.evidence} />
                </td>
                <td>
                  {formatWhen(v.changed_at)}
                  <br />
                  <span className="muted">by {shortName(users, v.changed_by)}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {flagged && (
        <Alert
          success={
            <>
              Saved {rule.code} v{flagged.version}.{' '}
              {flagged.refs.length === 0 ? (
                'No scheme uses this rule, so nothing was flagged.'
              ) : (
                <>
                  Flagged for review:{' '}
                  {flagged.refs.map((ref, i) => (
                    <span key={ref}>
                      {i > 0 && ', '}
                      <a href={hrefFor('schemes', ref)}>{ref}</a>
                    </span>
                  ))}
                  . Agents keep seeing the old rule version until each scheme is reviewed.
                </>
              )}
            </>
          }
        />
      )}

      {editing && latest && (
        <div className="subpanel">
          <h3>
            Change {rule.code} <Needs role="CENTRAL_REVIEWER" />
          </h3>
          <RuleForm
            initial={latest}
            submitLabel={`Save as v${latest.version_no + 1}`}
            onCancel={() => setEditing(false)}
            onSave={async (userId, input) => {
              const result = await api.changeRule(userId, rule.code, input);
              setFlagged({ version: result.rule.version_no, refs: result.flagged });
              setEditing(false);
              onChanged();
            }}
          />
        </div>
      )}
    </Section>
  );
}

function NewRule({ onChanged }: { onChanged: () => void }) {
  const [created, setCreated] = useState<string | null>(null);
  // Remounting the form after a save clears it.
  const [formKey, setFormKey] = useState(0);

  return (
    <>
      <RuleForm
        key={formKey}
        withCode
        submitLabel="Create rule"
        onSave={async (userId, input, code) => {
          const rule = await api.createRule(userId, code, input);
          setCreated(`Created ${rule.code} v${rule.version_no}.`);
          setFormKey((k) => k + 1);
          onChanged();
        }}
      />
      <Alert success={created} />
    </>
  );
}
