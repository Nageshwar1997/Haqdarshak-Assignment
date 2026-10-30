// What Central reviewers need to look at: versions in review and open rule-change flags.
import * as api from '../api.ts';
import { hasRole, shortName, useApp } from '../context.ts';
import { formatWhen } from '../format.ts';
import { hrefFor, useLoad } from '../hooks.ts';
import { Alert, Empty, Loading, Needs, Note, Section } from './ui.tsx';

export function ReviewQueuePage() {
  const { user, users } = useApp();
  const queue = useLoad(api.getReviewQueue, []);
  const q = queue.data;

  return (
    <>
      {user && !hasRole(user, 'CENTRAL_REVIEWER') && (
        <Note>Only Central reviewers act on this queue. You can look, but pick a Central reviewer in "Acting as" to approve.</Note>
      )}
      {queue.loading && !q && <Loading what="Loading review queue" />}
      <Alert error={queue.error} onRetry={queue.reload} />

      {q && (
        <>
          <Section title={`Waiting for review (${q.in_review.length})`} extra={<Needs role="CENTRAL_REVIEWER" />}>
            {q.in_review.length === 0 ? (
              <Empty>Nothing is waiting for review.</Empty>
            ) : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th scope="col">Scheme</th>
                      <th scope="col">Version</th>
                      <th scope="col">Revision</th>
                      <th scope="col">Created by</th>
                    </tr>
                  </thead>
                  <tbody>
                    {q.in_review.map((v) => (
                      <tr key={`${v.scheme_ref}-${v.version_no}`}>
                        <td>
                          <a href={hrefFor('schemes', v.scheme_ref)}>{v.scheme_ref}</a>
                        </td>
                        <td>v{v.version_no}</td>
                        <td>{v.revision}</td>
                        <td>{shortName(users, v.created_by)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Section>

          <Section title={`Open rule-change flags (${q.open_flags.length})`} extra={<Needs role="CENTRAL_REVIEWER" />}>
            {q.open_flags.length === 0 ? (
              <Empty>No open flags.</Empty>
            ) : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th scope="col">Scheme</th>
                      <th scope="col">Rule</th>
                      <th scope="col">Change</th>
                      <th scope="col">Flagged</th>
                    </tr>
                  </thead>
                  <tbody>
                    {q.open_flags.map((f) => (
                      <tr key={f.id}>
                        <td>
                          <a href={hrefFor('schemes', f.scheme_ref)}>{f.scheme_ref}</a>
                        </td>
                        <td>
                          <code>{f.rule_code}</code>
                        </td>
                        <td>
                          v{f.from_version} → v{f.to_version}
                        </td>
                        <td>{formatWhen(f.created_at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Section>
        </>
      )}
    </>
  );
}
