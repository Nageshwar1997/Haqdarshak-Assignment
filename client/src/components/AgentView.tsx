// Agent view: only what the read API serves, which is the published version of each scheme.
import * as api from '../api.ts';
import { shortName, useApp } from '../context.ts';
import { formatValue, formatWhen, ruleCondition } from '../format.ts';
import { hrefFor, useLoad } from '../hooks.ts';
import type { PublishedScheme } from '../types.ts';
import { EvidenceView, FieldList } from './FieldView.tsx';
import { Alert, Empty, Loading, Note, Section } from './ui.tsx';

const AGENT_NOTE = 'This is what agents see. Drafts never appear here.';

const nameOf = (s: PublishedScheme) => {
  const name = s.fields.find((f) => f.field === 'name');
  return name?.status === 'found' ? String(name.value) : s.scheme_ref;
};

export function AgentList() {
  const schemes = useLoad(api.listPublished, []);

  return (
    <Section title="Published schemes">
      <Note>{AGENT_NOTE}</Note>
      {schemes.loading && !schemes.data && <Loading what="Loading published schemes" />}
      <Alert error={schemes.error} onRetry={schemes.reload} />
      {schemes.data && schemes.data.length === 0 && <Empty>No scheme has been published yet.</Empty>}
      {schemes.data && schemes.data.length > 0 && (
        <ul className="scheme-cards">
          {schemes.data.map((s) => {
            const amount = s.fields.find((f) => f.field === 'benefit_amount');
            return (
              <li key={s.scheme_ref}>
                <a className="scheme-card" href={hrefFor('agent', s.scheme_ref)}>
                  <span className="scheme-card-name">{nameOf(s)}</span>
                  <span className="scheme-card-meta">
                    {s.scheme_ref} · v{s.version_no} · published {formatWhen(s.published_at)}
                  </span>
                  {amount?.status === 'found' && (
                    <span className="scheme-card-meta">Benefit: {formatValue(amount.value, 'benefit_amount')}</span>
                  )}
                </a>
              </li>
            );
          })}
        </ul>
      )}
    </Section>
  );
}

export function AgentScheme({ schemeRef }: { schemeRef: string }) {
  const { users } = useApp();
  const scheme = useLoad(() => api.getPublished(schemeRef), [schemeRef]);
  const s = scheme.data;

  return (
    <>
      <p className="crumbs">
        <a href={hrefFor('agent')}>← All published schemes</a>
      </p>
      {scheme.loading && !s && <Loading what={`Loading ${schemeRef}`} />}
      <Alert error={scheme.error} onRetry={scheme.reload} />
      {s && (
        <>
          <Section title={nameOf(s)}>
            <Note>{AGENT_NOTE}</Note>
            <p className="meta-line">
              {s.scheme_ref} · version {s.version_no} · published {formatWhen(s.published_at)} by {shortName(users, s.published_by)}
            </p>
            <FieldList records={s.fields} />
          </Section>

          <Section title="Eligibility (all must hold)">
            {s.eligibility.length === 0 ? (
              <Empty>No eligibility rules are attached to this version.</Empty>
            ) : (
              <ul className="rule-list">
                {s.eligibility.map((r) => (
                  <li key={r.code}>
                    <p>
                      <strong>
                        {r.code} v{r.version_no}
                      </strong>
                      : {r.description} <code>({ruleCondition(r)})</code>
                    </p>
                    <EvidenceView evidence={r.evidence} />
                  </li>
                ))}
              </ul>
            )}
          </Section>
        </>
      )}
    </>
  );
}
