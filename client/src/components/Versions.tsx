// Every version of a scheme, with a button to look at the content of any one of them.
import { useState } from 'react';
import * as api from '../api.ts';
import { shortName, useApp } from '../context.ts';
import { formatWhen } from '../format.ts';
import { useLoad } from '../hooks.ts';
import type { SchemeVersion } from '../types.ts';
import { FieldList } from './FieldView.tsx';
import { Alert, Badge, Empty, Loading, Section } from './ui.tsx';

type Props = { schemeRef: string; versions: SchemeVersion[]; refreshKey: number };

export function VersionsSection({ schemeRef, versions, refreshKey }: Props) {
  const { users } = useApp();
  const [viewing, setViewing] = useState<number | null>(null);

  return (
    <Section title="Versions">
      {versions.length === 0 ? (
        <Empty>No versions.</Empty>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th scope="col">Version</th>
                <th scope="col">Status</th>
                <th scope="col">Based on</th>
                <th scope="col">Created</th>
                <th scope="col">Rev</th>
                <th scope="col">Edited by</th>
                <th scope="col">Published</th>
                <th scope="col">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {versions.map((v) => (
                <tr key={v.version_no} className={viewing === v.version_no ? 'row-selected' : undefined}>
                  <td>v{v.version_no}</td>
                  <td>
                    <Badge status={v.status} />
                  </td>
                  <td>{v.based_on ? `v${v.based_on}` : '—'}</td>
                  <td>
                    {formatWhen(v.created_at)}
                    <br />
                    <span className="muted">by {shortName(users, v.created_by)}</span>
                  </td>
                  <td>{v.revision}</td>
                  <td>{v.editors.map((id) => shortName(users, id)).join(', ') || '—'}</td>
                  <td>
                    {v.published_at ? (
                      <>
                        {formatWhen(v.published_at)}
                        <br />
                        <span className="muted">by {shortName(users, v.published_by)}</span>
                      </>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td>
                    <button
                      type="button"
                      className="btn btn-small"
                      aria-expanded={viewing === v.version_no}
                      onClick={() => setViewing(viewing === v.version_no ? null : v.version_no)}
                    >
                      {viewing === v.version_no ? 'Hide' : 'View'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {viewing !== null && <VersionDetail schemeRef={schemeRef} no={viewing} refreshKey={refreshKey} />}
    </Section>
  );
}

// Content of one version, fetched from GET /api/schemes/:ref/versions/:no
function VersionDetail({ schemeRef, no, refreshKey }: { schemeRef: string; no: number; refreshKey: number }) {
  const version = useLoad(() => api.getVersion(schemeRef, no), [schemeRef, no, refreshKey]);
  const v = version.data;

  return (
    <div className="subpanel">
      <h3>
        Content of v{no} {v && <Badge status={v.status} />}
      </h3>
      {version.loading && !v && <Loading />}
      <Alert error={version.error} onRetry={version.reload} />
      {v && (
        <>
          <FieldList records={Object.values(v.fields)} />
          <PinnedRules rules={v.rules} />
        </>
      )}
    </div>
  );
}

export function PinnedRules({ rules }: { rules: Record<string, number> }) {
  const codes = Object.keys(rules);
  if (codes.length === 0) return <p className="empty">No eligibility rules attached.</p>;
  return (
    <p className="inline-list">
      <span className="muted">Eligibility rules:</span>
      {codes.map((c) => (
        <code key={c}>
          {c} v{rules[c]}
        </code>
      ))}
    </p>
  );
}
