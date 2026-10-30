// Top bar: app title, "Acting as" user picker and the reset button.
import * as api from '../api.ts';
import { ROLE_LABEL } from '../context.ts';
import { useAction } from '../hooks.ts';
import type { User } from '../types.ts';
import { Alert } from './ui.tsx';

type Props = {
  users: User[];
  user: User | null;
  onChooseUser: (id: string) => void;
  onReset: () => void;
};

export function Header({ users, user, onChooseUser, onReset }: Props) {
  const reset = useAction();

  async function handleReset() {
    if (!window.confirm('Wipe all changes and load the synthetic demo data again?')) return;
    const ok = await reset.run(() => api.resetDemo(user?.id), 'Demo data was reset.');
    if (ok) onReset();
  }

  return (
    <header className="header">
      <div className="header-inner">
        <div className="brand">
          <h1>Scheme Knowledge Base</h1>
          <p>Review and publish welfare scheme records. A second person checks every change before it goes live.</p>
        </div>

        <div className="header-tools">
          <label className="acting-as">
            <span>Acting as</span>
            <select value={user?.id ?? ''} onChange={(e) => onChooseUser(e.target.value)} disabled={users.length === 0}>
              {users.length === 0 && <option value="">No users loaded</option>}
              {users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name} · {u.roles.map((r) => ROLE_LABEL[r]).join(' + ')}
                </option>
              ))}
            </select>
          </label>
          <button type="button" className="btn btn-quiet" onClick={handleReset} disabled={reset.busy}>
            {reset.busy ? 'Resetting…' : 'Reset demo data'}
          </button>
        </div>
      </div>
      {(reset.error || reset.done) && (
        <div className="header-inner header-alert">
          <Alert error={reset.error} success={reset.done} />
        </div>
      )}
    </header>
  );
}
