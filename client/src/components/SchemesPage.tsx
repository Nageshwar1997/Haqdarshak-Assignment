// Reviewer workspace home: every scheme (also never-published ones) and a "New scheme" form.
import { useState } from 'react';
import type { FormEvent } from 'react';
import * as api from '../api.ts';
import { hasRole, shortName, useApp } from '../context.ts';
import { hrefFor, useAction, useLoad } from '../hooks.ts';
import { Alert, Badge, Empty, Loading, Needs, Note, Section } from './ui.tsx';

export function SchemesPage() {
  const { users, user } = useApp();
  const schemes = useLoad(api.listStaffSchemes, []);

  return (
    <>
      <Section title="All schemes">
        {schemes.loading && !schemes.data && <Loading what="Loading schemes" />}
        <Alert error={schemes.error} onRetry={schemes.reload} />
        {schemes.data && schemes.data.length === 0 && <Empty>No schemes yet.</Empty>}
        {schemes.data && schemes.data.length > 0 && (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th scope="col">Scheme</th>
                  <th scope="col">Name</th>
                  <th scope="col">Published</th>
                  <th scope="col">Open version</th>
                  <th scope="col">Open flags</th>
                </tr>
              </thead>
              <tbody>
                {schemes.data.map((s) => (
                  <tr key={s.scheme_ref}>
                    <td>
                      <a href={hrefFor('schemes', s.scheme_ref)}>{s.scheme_ref}</a>
                    </td>
                    <td>{s.name ?? <span className="value-empty">No name yet</span>}</td>
                    <td>{s.published_version ? `v${s.published_version}` : <span className="value-empty">never</span>}</td>
                    <td>
                      {s.open_version ? (
                        <span className="inline-list">
                          v{s.open_version.version_no} <Badge status={s.open_version.status} />
                          <span className="muted">
                            rev {s.open_version.revision} · by {shortName(users, s.open_version.created_by)}
                          </span>
                        </span>
                      ) : (
                        <span className="value-empty">none</span>
                      )}
                    </td>
                    <td>{s.open_flags > 0 ? <span className="count-warn">{s.open_flags}</span> : 0}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      <Section title="New scheme" extra={<Needs role="STATE_REVIEWER" />}>
        {hasRole(user, 'STATE_REVIEWER') ? (
          <NewSchemeForm />
        ) : (
          <Note>Only State reviewers can create schemes. Pick one in "Acting as".</Note>
        )}
      </Section>
    </>
  );
}

function NewSchemeForm() {
  const { user } = useApp();
  const [ref, setRef] = useState('');
  const create = useAction();

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!user) return;
    const created = await create.run(() => api.createScheme(user.id, ref.trim()));
    // Open the new scheme straight away so the reviewer can fill its fields.
    if (created) window.location.hash = hrefFor('schemes', created.scheme_ref);
  }

  return (
    <form className="form form-inline" onSubmit={handleSubmit}>
      <label>
        <span>Scheme reference</span>
        <input value={ref} onChange={(e) => setRef(e.target.value)} placeholder="e.g. SYN-UP-005" required />
      </label>
      <button type="submit" className="btn btn-primary" disabled={create.busy}>
        {create.busy ? 'Creating…' : 'Create draft v1'}
      </button>
      <Alert error={create.error} />
    </form>
  );
}
