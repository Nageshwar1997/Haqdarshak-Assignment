// One scheme in the reviewer workspace: versions, the open draft, review, flags and history.
import { useState } from 'react';
import type { ReactNode } from 'react';
import * as api from '../api.ts';
import { hasRole, useApp } from '../context.ts';
import { hrefFor, useLoad } from '../hooks.ts';
import type { SchemeVersion } from '../types.ts';
import { DraftPanel } from './DraftPanel.tsx';
import { FlagsPanel } from './FlagsPanel.tsx';
import { HistoryPanel } from './HistoryPanel.tsx';
import { ReviewPanel } from './ReviewPanel.tsx';
import { VersionsSection } from './Versions.tsx';
import { Alert, Badge, Loading, Note, Section } from './ui.tsx';

const nameIn = (v: SchemeVersion | null) => {
  const name = v?.fields.name;
  return name?.status === 'found' ? String(name.value) : null;
};

export function Workspace({ schemeRef }: { schemeRef: string }) {
  const { user } = useApp();
  // Every successful write bumps this key, so all data on the page is fetched again.
  const [refreshKey, setRefreshKey] = useState(0);
  const [flash, setFlash] = useState<ReactNode>(null);

  const versions = useLoad(() => api.listVersions(schemeRef), [schemeRef, refreshKey]);
  const flags = useLoad(() => api.listFlags(schemeRef), [schemeRef, refreshKey]);
  const history = useLoad(() => api.getHistory(schemeRef), [schemeRef, refreshKey]);
  const rules = useLoad(api.listRules, [refreshKey]);

  // Called after a write. A message is shown at the top, because the panel that did the write may disappear.
  function changed(message?: string) {
    setRefreshKey((k) => k + 1);
    setFlash(message ?? null);
    if (message) window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  const list = versions.data ?? [];
  const open = list.find((v) => v.status === 'draft' || v.status === 'in_review') ?? null;
  const live = list.find((v) => v.status === 'published') ?? null;
  const name = nameIn(open) ?? nameIn(live);

  return (
    <>
      <p className="crumbs">
        <a href={hrefFor('schemes')}>← All schemes</a>
      </p>

      {versions.loading && !versions.data && <Loading what={`Loading ${schemeRef}`} />}
      <Alert error={versions.error} onRetry={versions.reload} />

      {versions.data && (
        <>
          <Section title={name ?? schemeRef}>
            <ul className="facts">
              <li>
                <span className="muted">Reference</span> {schemeRef}
              </li>
              <li>
                <span className="muted">Agents see</span>{' '}
                {live ? <a href={hrefFor('agent', schemeRef)}>v{live.version_no} (published)</a> : 'nothing yet (never published)'}
              </li>
              <li>
                <span className="muted">Open version</span>{' '}
                {open ? (
                  <>
                    v{open.version_no} <Badge status={open.status} /> rev {open.revision}
                  </>
                ) : (
                  'none'
                )}
              </li>
            </ul>
            <Alert success={flash} />
          </Section>

          <VersionsSection schemeRef={schemeRef} versions={list} refreshKey={refreshKey} />

          <DraftPanel
            schemeRef={schemeRef}
            open={open}
            live={live}
            rules={rules.data ?? []}
            events={history.data?.events ?? []}
            onChanged={changed}
          />

          {open?.status === 'in_review' &&
            (hasRole(user, 'CENTRAL_REVIEWER') ? (
              <ReviewPanel schemeRef={schemeRef} version={open} refreshKey={refreshKey} onChanged={changed} />
            ) : (
              <Section title="Review">
                <Note>v{open.version_no} is waiting for a Central reviewer to approve it or send it back.</Note>
              </Section>
            ))}

          <FlagsPanel flags={flags} rules={rules.data ?? []} onChanged={changed} />
          <HistoryPanel history={history} />
        </>
      )}
    </>
  );
}
