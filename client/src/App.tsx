// App shell: loads users and the field catalogue, remembers the acting user, and picks the page from the URL hash.
import { useState } from 'react';
import * as api from './api.ts';
import { AppContext } from './context.ts';
import { hrefFor, useHashRoute, useLoad } from './hooks.ts';
import type { Tab } from './hooks.ts';
import { AgentList, AgentScheme } from './components/AgentView.tsx';
import { Header } from './components/Header.tsx';
import { ReviewQueuePage } from './components/ReviewQueue.tsx';
import { RulesPage } from './components/RulesPage.tsx';
import { SchemesPage } from './components/SchemesPage.tsx';
import { Workspace } from './components/Workspace.tsx';
import { Alert, Loading } from './components/ui.tsx';

const USER_KEY = 'skb.actingUser';

// localStorage can throw (private mode, blocked storage), so every access is wrapped.
function savedUser(): string | null {
  try {
    return window.localStorage.getItem(USER_KEY);
  } catch {
    return null;
  }
}

function saveUser(id: string) {
  try {
    window.localStorage.setItem(USER_KEY, id);
  } catch {
    // not saved; the choice still works for this visit
  }
}

const TABS: { tab: Tab; label: string }[] = [
  { tab: 'agent', label: 'Agent view (published)' },
  { tab: 'schemes', label: 'Schemes (reviewer workspace)' },
  { tab: 'review', label: 'Review queue' },
  { tab: 'rules', label: 'Shared rules' },
];

export default function App() {
  const route = useHashRoute();
  // Bumped after "Reset demo data": every page remounts and fetches again.
  const [resetKey, setResetKey] = useState(0);
  const users = useLoad(api.listUsers, [resetKey]);
  const meta = useLoad(api.getMeta, [resetKey]);
  const [userId, setUserId] = useState<string | null>(savedUser);

  const userList = users.data ?? [];
  // Fall back to the first user if the saved one no longer exists.
  const user = userList.find((u) => u.id === userId) ?? userList[0] ?? null;

  function chooseUser(id: string) {
    setUserId(id);
    saveUser(id);
  }

  return (
    <AppContext.Provider value={{ users: userList, user, fields: meta.data?.fields ?? [] }}>
      <Header users={userList} user={user} onChooseUser={chooseUser} onReset={() => setResetKey((k) => k + 1)} />

      <nav className="tabs" aria-label="Sections">
        <div className="tabs-inner">
          {TABS.map((t) => (
            <a key={t.tab} href={hrefFor(t.tab)} className="tab" aria-current={route.tab === t.tab ? 'page' : undefined}>
              {t.label}
            </a>
          ))}
        </div>
      </nav>

      <main className="main" key={resetKey}>
        {users.loading && !users.data && <Loading what="Loading users" />}
        {users.error && <Alert error={users.error} onRetry={users.reload} />}
        {meta.error && <Alert error={meta.error} onRetry={meta.reload} />}

        {route.tab === 'agent' && (route.ref ? <AgentScheme key={route.ref} schemeRef={route.ref} /> : <AgentList />)}
        {route.tab === 'schemes' && (route.ref ? <Workspace key={route.ref} schemeRef={route.ref} /> : <SchemesPage />)}
        {route.tab === 'review' && <ReviewQueuePage />}
        {route.tab === 'rules' && <RulesPage />}
      </main>
    </AppContext.Provider>
  );
}
