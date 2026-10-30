// Typed client for every endpoint in the API contract.
// Write calls take the acting user's id first (like store.ts does) and send it as X-User-Id.
import type {
  Diff,
  ErrorCode,
  FieldInput,
  FieldMeta,
  FieldRecord,
  History,
  PublishedScheme,
  ReviewFlag,
  ReviewQueue,
  RuleInput,
  RuleSummary,
  RuleVersion,
  SchemeSummary,
  SchemeVersion,
  User,
} from './types.ts';

// An error from the server. `message` is written for people, so the UI shows it as-is.
export class ApiError extends Error {
  status: number; // HTTP status, or 0 when the server could not be reached
  error: ErrorCode | 'NETWORK';
  constructor(status: number, error: ErrorCode | 'NETWORK', message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.error = error;
  }
}

type Method = 'GET' | 'POST' | 'PUT' | 'DELETE';

async function request<T>(method: Method, path: string, options: { userId?: string; body?: unknown } = {}): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (options.userId) headers['X-User-Id'] = options.userId;
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';

  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      method,
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
  } catch {
    throw new ApiError(0, 'NETWORK', 'Cannot reach the server. Check that it is running, then try again.');
  }

  // Read the body once; it should be JSON both on success and on error.
  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }

  if (!res.ok) {
    const body = (data ?? {}) as { error?: ErrorCode; message?: string };
    throw new ApiError(res.status, body.error ?? 'INTERNAL', body.message ?? `Request failed with status ${res.status}`);
  }
  return data as T;
}

const seg = (s: string | number) => encodeURIComponent(String(s));
const scheme = (ref: string) => `/schemes/${seg(ref)}`;

// ---------- Read API (what agents see: published versions only) ----------

export const listPublished = () => request<PublishedScheme[]>('GET', '/schemes');
export const getPublished = (ref: string) => request<PublishedScheme>('GET', scheme(ref));

// ---------- Reviewer views ----------

export const listUsers = () => request<User[]>('GET', '/users');
export const getMeta = () => request<{ fields: FieldMeta[] }>('GET', '/meta');
export const listStaffSchemes = () => request<SchemeSummary[]>('GET', '/staff/schemes');
export const listVersions = (ref: string) => request<SchemeVersion[]>('GET', `${scheme(ref)}/versions`);
export const getVersion = (ref: string, no: number) => request<SchemeVersion>('GET', `${scheme(ref)}/versions/${seg(no)}`);
export const getHistory = (ref: string) => request<History>('GET', `${scheme(ref)}/history`);
export const getDiff = (ref: string) => request<Diff>('GET', `${scheme(ref)}/diff`);
export const listFlags = (ref: string) => request<ReviewFlag[]>('GET', `${scheme(ref)}/flags`);
export const getReviewQueue = () => request<ReviewQueue>('GET', '/review-queue');
export const listRules = () => request<RuleSummary[]>('GET', '/rules');

// ---------- Writes: State reviewer ----------

export const createScheme = (userId: string, scheme_ref: string) =>
  request<SchemeVersion>('POST', '/schemes', { userId, body: { scheme_ref } });

export const startDraft = (userId: string, ref: string) => request<SchemeVersion>('POST', `${scheme(ref)}/draft`, { userId });

export const setField = (userId: string, ref: string, input: FieldInput) =>
  request<FieldRecord>('PUT', `${scheme(ref)}/draft/fields`, { userId, body: input });

export const attachRule = (userId: string, ref: string, code: string) =>
  request<SchemeVersion>('PUT', `${scheme(ref)}/draft/rules/${seg(code)}`, { userId });

export const removeRule = (userId: string, ref: string, code: string) =>
  request<SchemeVersion>('DELETE', `${scheme(ref)}/draft/rules/${seg(code)}`, { userId });

export const submitDraft = (userId: string, ref: string) =>
  request<SchemeVersion>('POST', `${scheme(ref)}/draft/submit`, { userId });

export const discardDraft = (userId: string, ref: string) => request<SchemeVersion>('DELETE', `${scheme(ref)}/draft`, { userId });

// ---------- Writes: Central reviewer ----------

export const sendBack = (userId: string, ref: string, comment: string) =>
  request<SchemeVersion>('POST', `${scheme(ref)}/draft/send-back`, { userId, body: { comment } });

// `revision` is the revision the reviewer looked at; the server refuses if the draft changed since.
export const publish = (userId: string, ref: string, revision: number) =>
  request<SchemeVersion>('POST', `${scheme(ref)}/draft/publish`, { userId, body: { revision } });

export const createRule = (userId: string, code: string, input: RuleInput) =>
  request<RuleVersion>('POST', '/rules', { userId, body: { code, ...input } });

export const changeRule = (userId: string, code: string, input: RuleInput) =>
  request<{ rule: RuleVersion; flagged: string[] }>('POST', `/rules/${seg(code)}/versions`, { userId, body: input });

export const dismissFlag = (userId: string, id: number, note: string) =>
  request<ReviewFlag>('POST', `/flags/${seg(id)}/dismiss`, { userId, body: { note } });

// ---------- Dev helper ----------

// Wipes everything and loads the synthetic data again. Sent with the acting user, though the server does not need it.
export const resetDemo = (userId?: string) => request<{ ok: true }>('POST', '/reset', { userId });
