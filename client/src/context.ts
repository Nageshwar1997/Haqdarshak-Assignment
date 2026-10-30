// Shared app data: the users, the acting user and the field catalogue.
// Plain React context, no state library.
import { createContext, useContext } from 'react';
import type { FieldMeta, Role, User } from './types.ts';

export type AppData = {
  users: User[];
  user: User | null; // who the reviewer is "acting as"
  fields: FieldMeta[]; // from GET /api/meta
};

export const AppContext = createContext<AppData>({ users: [], user: null, fields: [] });

export const useApp = () => useContext(AppContext);

export const hasRole = (user: User | null, role: Role) => !!user && user.roles.includes(role);

export const ROLE_LABEL: Record<Role, string> = {
  STATE_REVIEWER: 'State reviewer',
  CENTRAL_REVIEWER: 'Central reviewer',
};

// "Asha (State reviewer, MH)" -> "Asha". Falls back to the id for unknown users.
export function shortName(users: User[], id: string | null | undefined): string {
  if (!id) return '—';
  const user = users.find((u) => u.id === id);
  return user ? user.name.split(' (')[0] : id;
}

export function fieldLabel(fields: FieldMeta[], name: string): string {
  if (name.startsWith('rule:')) return `Rule ${name.slice(5)}`;
  return fields.find((f) => f.name === name)?.label ?? name;
}
