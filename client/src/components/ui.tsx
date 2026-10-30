// Small building blocks used on every page: alerts, badges, role tags, loading and empty states.
import type { ReactNode } from 'react';
import type { ApiError } from '../api.ts';
import { ROLE_LABEL } from '../context.ts';
import type { Role } from '../types.ts';

// Shows a server error message as-is (they are written for reviewers), or a success line.
export function Alert({ error, success, onRetry }: { error?: ApiError | null; success?: ReactNode; onRetry?: () => void }) {
  if (error) {
    return (
      <div className="alert alert-error" role="alert">
        <p>{error.message}</p>
        <p className="alert-code">{error.status ? `${error.status} ${error.error}` : error.error}</p>
        {onRetry && (
          <button type="button" className="btn btn-small" onClick={onRetry}>
            Reload
          </button>
        )}
      </div>
    );
  }
  if (success) {
    return (
      <div className="alert alert-success" role="status">
        {success}
      </div>
    );
  }
  return null;
}

export function Note({ children }: { children: ReactNode }) {
  return <p className="note">{children}</p>;
}

export function Loading({ what = 'Loading' }: { what?: string }) {
  return (
    <p className="loading" role="status">
      {what}…
    </p>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="empty">{children}</p>;
}

// One coloured pill for any status: version, field, flag or workflow action.
export function Badge({ status }: { status: string }) {
  return <span className={`badge badge-${status}`}>{status.replace(/_/g, ' ')}</span>;
}

// Tells the reviewer which role an action needs.
export function Needs({ role }: { role: Role }) {
  return <span className={`needs needs-${role === 'STATE_REVIEWER' ? 'state' : 'central'}`}>Needs: {ROLE_LABEL[role]}</span>;
}

export function Section({ title, extra, children }: { title: ReactNode; extra?: ReactNode; children: ReactNode }) {
  return (
    <section className="card">
      <div className="card-head">
        <h2>{title}</h2>
        {extra}
      </div>
      {children}
    </section>
  );
}
