// Everything that ever happened to a scheme: field changes (with sources) and workflow events.
import { fieldLabel, shortName, useApp } from '../context.ts';
import { formatWhen, sourceRefs } from '../format.ts';
import type { Loaded } from '../hooks.ts';
import type { History } from '../types.ts';
import { Value } from './FieldView.tsx';
import { Alert, Badge, Empty, Loading, Section } from './ui.tsx';

export function HistoryPanel({ history }: { history: Loaded<History> }) {
  const { users, fields } = useApp();
  const h = history.data;

  return (
    <Section title="History">
      {history.loading && !h && <Loading what="Loading history" />}
      <Alert error={history.error} onRetry={history.reload} />

      {h && (
        <>
          <h3>Workflow</h3>
          {h.events.length === 0 ? (
            <Empty>No events yet.</Empty>
          ) : (
            <ol className="timeline">
              {h.events.map((e, i) => (
                <li key={i}>
                  <span className="timeline-when">{formatWhen(e.at)}</span>
                  <span>
                    v{e.version_no} <Badge status={e.action} /> by {shortName(users, e.by)}
                  </span>
                  {e.comment && <p className="quote">{e.comment}</p>}
                </li>
              ))}
            </ol>
          )}

          <h3>Field changes</h3>
          {h.changes.length === 0 ? (
            <Empty>No field changes yet.</Empty>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th scope="col">When</th>
                    <th scope="col">Who</th>
                    <th scope="col">Version</th>
                    <th scope="col">Field</th>
                    <th scope="col">Old → new</th>
                    <th scope="col">Source</th>
                  </tr>
                </thead>
                <tbody>
                  {h.changes.map((c, i) => {
                    const field = c.field.startsWith('rule:') ? undefined : c.field;
                    return (
                      <tr key={i}>
                        <td>{formatWhen(c.changed_at)}</td>
                        <td>{shortName(users, c.changed_by)}</td>
                        <td>v{c.version_no}</td>
                        <td>{fieldLabel(fields, c.field)}</td>
                        <td>
                          <div className="change">
                            <span className="before">
                              <Value value={c.old_value} field={field} />
                            </span>
                            <span aria-hidden="true">→</span>
                            <span className="after">
                              <Value value={c.new_value} field={field} />
                            </span>
                          </div>
                        </td>
                        <td className="source-cell">{sourceRefs(c.source)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </Section>
  );
}
