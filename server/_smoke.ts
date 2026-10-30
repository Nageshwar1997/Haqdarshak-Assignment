import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { createApp } from './src/app.ts';
import { connect, disconnect } from './src/db.ts';
import { seed } from './src/seed.ts';

await connect({ useMemory: true });
await seed();
const server = createApp().listen(0);
await once(server, 'listening');
const BASE = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
const ev = { text: 't', location: 'l', source_ref: 's', captured_at: '2026-10-01' };
async function req(method: string, path: string, user?: string, body?: unknown, raw?: string) {
  const headers: Record<string, string> = {};
  if (user) headers['x-user-id'] = user;
  if (body !== undefined || raw !== undefined) headers['content-type'] = 'application/json';
  const res = await fetch(BASE + path, { method, headers, body: raw ?? (body === undefined ? undefined : JSON.stringify(body)) });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}
const show = async (label: string, p: Promise<{ status: number; body: any }>) => {
  const r = await p;
  console.log(label.padEnd(40), r.status, JSON.stringify(r.body).slice(0, 170));
  return r;
};
await show('bad json', req('POST', '/schemes', 'asha', undefined, '{"scheme_ref":'));
await show('unknown api route', req('GET', '/nope'));
await show('unknown api route POST', req('POST', '/schemes/X/whatever', 'asha', {}));
await show('missing header', req('POST', '/schemes', undefined, { scheme_ref: 'A' }));
await show('unknown user', req('POST', '/schemes', 'ghost', { scheme_ref: 'A' }));
await show('createScheme object ref', req('POST', '/schemes', 'asha', { scheme_ref: { $ne: null } }));
await show('meta', req('GET', '/meta'));
await show('staff schemes', req('GET', '/staff/schemes'));
await show('users', req('GET', '/users'));
await show('rules', req('GET', '/rules'));
await show('createRule ok', req('POST', '/rules', 'meera', { code: 'WIDOW', concept: 'marital_status', operator: '=', value: 'widow', description: 'Widow', evidence: ev }));
await show('createRule dup', req('POST', '/rules', 'meera', { code: 'WIDOW', concept: 'c', operator: '=', value: 1, description: 'd', evidence: ev }));
await show('createRule bad code', req('POST', '/rules', 'meera', { code: 'a.b', concept: 'c', operator: '=', value: 1, description: 'd', evidence: ev }));
await show('createRule as state', req('POST', '/rules', 'asha', { code: 'X', concept: 'c', operator: '=', value: 1, description: 'd', evidence: ev }));
await show('createRule no evidence', req('POST', '/rules', 'meera', { code: 'Y', concept: 'c', operator: '=', value: 1, description: 'd' }));
await show('version abc', req('GET', '/schemes/SYN-MH-002/versions/abc'));
await show('version 99', req('GET', '/schemes/SYN-MH-002/versions/99'));
await show('scheme NOPE', req('GET', '/schemes/NOPE'));
await show('history NOPE', req('GET', '/schemes/NOPE/history'));
await show('diff without draft', req('GET', '/schemes/SYN-MH-002/diff'));
await show('flag abc dismiss', req('POST', '/flags/abc/dismiss', 'meera', { note: 'x' }));
await show('remove rule no draft', req('DELETE', '/schemes/SYN-MH-002/draft/rules/SC_ST', 'asha'));
await show('start draft MH', req('POST', '/schemes/SYN-MH-002/draft', 'asha'));
await show('diff fresh draft', req('GET', '/schemes/SYN-MH-002/diff'));
await show('remove rule not attached', req('DELETE', '/schemes/SYN-MH-002/draft/rules/SC_ST', 'asha'));
await show('use unknown rule', req('PUT', '/schemes/SYN-MH-002/draft/rules/NOPE', 'asha'));
await show('field constructor', req('PUT', '/schemes/SYN-MH-002/draft/fields', 'asha', { field: 'constructor', value: 1, status: 'found', confidence: 1, evidence: ev }));
await show('not_found partial evidence', req('PUT', '/schemes/SYN-MH-002/draft/fields', 'asha', { field: 'application_steps', value: null, status: 'not_found', note: 'not stated', evidence: { text: '' } }));
await show('instalments 2.5', req('PUT', '/schemes/SYN-MH-002/draft/fields', 'asha', { field: 'instalments', value: 2.5, status: 'found', confidence: 1, evidence: ev }));
await show('bad date', req('PUT', '/schemes/SYN-MH-002/draft/fields', 'asha', { field: 'deadline', value: '2026-13-45', status: 'found', confidence: 1, evidence: ev }));
await show('confidence 2', req('PUT', '/schemes/SYN-MH-002/draft/fields', 'asha', { field: 'deadline', value: '2026-12-01', status: 'found', confidence: 2, evidence: ev }));
await show('submit', req('POST', '/schemes/SYN-MH-002/draft/submit', 'asha'));
await show('discard while in review', req('DELETE', '/schemes/SYN-MH-002/draft', 'asha'));
await show('publish revision as string', req('POST', '/schemes/SYN-MH-002/draft/publish', 'meera', { revision: '1' }));
await show('publish no body', req('POST', '/schemes/SYN-MH-002/draft/publish', 'meera'));
await show('review queue', req('GET', '/review-queue'));
await show('publish ok', req('POST', '/schemes/SYN-MH-002/draft/publish', 'meera', { revision: 1 }));
const h = await req('GET', '/schemes/SYN-MH-002/history');
console.log('history last change'.padEnd(40), JSON.stringify(h.body.changes.at(-1)).slice(0, 200));
const two = async (label: string, a: Promise<any>, b: Promise<any>) => {
  const rs = await Promise.all([a, b]);
  console.log(label.padEnd(40), rs.map((r) => `${r.status} ${r.body.message ?? ''}`.slice(0, 90)).join(' | '));
};
await two('race createScheme same ref', req('POST', '/schemes', 'asha', { scheme_ref: 'SYN-RACE-1' }), req('POST', '/schemes', 'ravi', { scheme_ref: 'SYN-RACE-1' }));
await two('race startDraft same scheme', req('POST', '/schemes/SYN-KA-004/draft', 'asha'), req('POST', '/schemes/SYN-KA-004/draft', 'ravi'));
await two(
  'race rule change',
  req('POST', '/rules/AGE_60_PLUS/versions', 'meera', { concept: 'age', operator: '>=', value: 58, description: 'a', evidence: ev }),
  req('POST', '/rules/AGE_60_PLUS/versions', 'vikram', { concept: 'age', operator: '>=', value: 59, description: 'b', evidence: ev }),
);
await show('flags KA-004 after 2 rule changes', req('GET', '/schemes/SYN-KA-004/flags'));
await show('reset', req('POST', '/reset'));
await show('staff schemes after reset', req('GET', '/staff/schemes'));
process.env.NODE_ENV = 'production';
await show('reset in production', req('POST', '/reset'));
delete process.env.NODE_ENV;
const spa = express();
spa.get('/{*page}', (r, res) => res.send('spa:' + r.path));
const s2 = spa.listen(0);
await once(s2, 'listening');
const p2 = (s2.address() as AddressInfo).port;
for (const path of ['/', '/review/SYN-MH-002', '/a/b/c']) console.log('spa', path, await (await fetch(`http://127.0.0.1:${p2}${path}`)).text());
s2.close();
server.close();
server.closeAllConnections();
await disconnect();
