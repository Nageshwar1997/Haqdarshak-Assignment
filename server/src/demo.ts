// Walks through every rule in the S1 brief with synthetic data and checks each one, through the real HTTP API.
// Run: npm run demo   (always uses a fresh in-memory MongoDB; exits with code 1 if any check fails)
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { createApp } from './app.ts';
import { connect, disconnect } from './db.ts';
import { FieldChangeModel, GuardError, SchemeVersionModel } from './models.ts';
import { ev, seed } from './seed.ts';
import type { FieldChange, FieldInput, PublishedScheme, ReviewFlag, ReviewQueue, RuleVersion, SchemeVersion, WorkflowEvent } from './types.ts';

await connect({ useMemory: true });
await seed();
const server = createApp().listen(0); // port 0: any free port
await once(server, 'listening');
const BASE = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;

let passed = 0;
let failed = 0;

function check(label: string, ok: boolean) {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (ok) passed++;
  else failed++;
}

const section = (title: string) => console.log(`\n${title}\n${'-'.repeat(title.length)}`);

// ---------- small HTTP client ----------

type Reply = { status: number; body: unknown };
type ApiError = { error?: string; message?: string };
const STATUS: Record<string, number> = { FORBIDDEN: 403, NOT_FOUND: 404, CONFLICT: 409, INVALID: 422 };

async function call(method: string, path: string, user?: string, body?: unknown): Promise<Reply> {
  const headers: Record<string, string> = {};
  if (user) headers['x-user-id'] = user;
  if (body !== undefined) headers['content-type'] = 'application/json';
  const res = await fetch(BASE + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, body: await res.json() };
}

// A step of the story that must work. If it does not, the demo stops with the server's message.
async function ok<T>(method: string, path: string, user?: string, body?: unknown): Promise<T> {
  const r = await call(method, path, user, body);
  const e = r.body as ApiError;
  if (r.status !== 200) throw new Error(`${method} ${path} as ${user ?? 'nobody'}: ${r.status} ${e.error}: ${e.message}`);
  return r.body as T;
}

// The request must be refused with this error code (and the matching HTTP status).
async function refused(label: string, code: string, method: string, path: string, user?: string, body?: unknown) {
  const r = await call(method, path, user, body);
  const e = r.body as ApiError;
  if (r.status === 200) return check(`${label} (but it was allowed!)`, false);
  check(label, e.error === code && r.status === STATUS[code]);
  console.log(`        -> ${e.message}`);
}

// Writes straight through a Mongoose model (skipping the API). The data-layer guard must refuse every one.
async function guardRefuses(label: string, writes: (() => Promise<unknown>)[], stillIntact: () => Promise<boolean>) {
  const messages: string[] = [];
  let all = true;
  for (const write of writes) {
    try {
      await write();
      all = false;
    } catch (err) {
      all &&= err instanceof GuardError;
      messages.push(err instanceof Error ? err.message : String(err));
    }
  }
  check(label, all && (await stillIntact()));
  for (const m of messages) console.log(`        -> ${m}`);
}

const get = <T>(path: string) => ok<T>('GET', path);
const published = (ref: string) => get<PublishedScheme>(`/schemes/${ref}`);
const version = (ref: string, no: number) => get<SchemeVersion>(`/schemes/${ref}/versions/${no}`);
const historyOf = (ref: string) => get<{ changes: FieldChange[]; events: WorkflowEvent[] }>(`/schemes/${ref}/history`);
const setField = (user: string, ref: string, input: FieldInput) => ok('PUT', `/schemes/${ref}/draft/fields`, user, input);
const startDraft = (user: string, ref: string) => ok<SchemeVersion>('POST', `/schemes/${ref}/draft`, user);
const submit = async (user: string, ref: string) => (await ok<SchemeVersion>('POST', `/schemes/${ref}/draft/submit`, user)).revision;
const sendBack = (user: string, ref: string, comment: string) => ok('POST', `/schemes/${ref}/draft/send-back`, user, { comment });
const publish = (user: string, ref: string, revision: number) => ok('POST', `/schemes/${ref}/draft/publish`, user, { revision });
const amountOf = async (ref: string) => (await published(ref)).fields.find((f) => f.field === 'benefit_amount')?.value;
const incomeLimit = async (ref: string) => (await published(ref)).eligibility.find((r) => r.code === 'INCOME_BELOW_2_5L')?.value;

async function run() {
  console.log(`Loaded ${(await get<PublishedScheme[]>('/schemes')).length} published synthetic schemes.`);
  const sample = await Promise.all(
    ['/schemes', '/schemes/SYN-MH-002', '/staff/schemes', '/schemes/SYN-MH-002/versions', '/schemes/SYN-MH-002/history', '/rules', '/review-queue', '/users'].map(
      (path) => get<unknown>(path),
    ),
  );
  check('API responses carry no MongoDB internals (_id, __v)', !/"(_id|__v)"/.test(JSON.stringify(sample)));

  // ---------------------------------------------------------------------------
  section('Rule 1: two roles, and nobody approves their own draft');
  const up = 'SYN-UP-005';
  const upPortal = 'synthetic: UP social welfare portal, scheme page';
  const upGO = 'synthetic: UP Government Order 2026-04 (PDF)';

  await refused('A Central reviewer cannot create a draft', 'FORBIDDEN', 'POST', '/schemes', 'meera', { scheme_ref: up });
  await ok('POST', '/schemes', 'neha', { scheme_ref: up });
  await setField('neha', up, {
    field: 'name',
    value: 'Widow Pension, Uttar Pradesh (synthetic)',
    evidence: ev('Widow Pension Scheme', 'Page title', upPortal),
    confidence: 0.9,
    status: 'found',
  });
  await setField('neha', up, {
    field: 'benefit_amount',
    value: 1000,
    evidence: ev('Rs. 1,000 per month', 'Benefits section', upPortal),
    confidence: 0.8,
    status: 'found',
  });
  await refused('The read API does not serve a scheme that only has a draft', 'NOT_FOUND', 'GET', `/schemes/${up}`);
  await refused('A Central reviewer cannot edit a draft', 'FORBIDDEN', 'PUT', `/schemes/${up}/draft/fields`, 'meera', {
    field: 'benefit_amount',
    value: 1,
    evidence: ev('x', 'x', 'x'),
    confidence: 1,
    status: 'found',
  });
  let rev = await submit('neha', up);
  await refused('A State reviewer cannot publish', 'FORBIDDEN', 'POST', `/schemes/${up}/draft/publish`, 'asha', { revision: rev });
  await refused('Neha has both roles but drafted this, so she cannot approve it', 'FORBIDDEN', 'POST', `/schemes/${up}/draft/publish`, 'neha', {
    revision: rev,
  });

  // ---------------------------------------------------------------------------
  section('Rule 2: draft -> in review -> published, or sent back with a comment');
  check('After submit the scheme is "in review"', (await version(up, 1)).status === 'in_review');
  await refused('Nobody can edit a draft while it is in review', 'CONFLICT', 'PUT', `/schemes/${up}/draft/fields`, 'neha', {
    field: 'benefit_amount',
    value: 1500,
    evidence: ev('x', 'x', 'x'),
    confidence: 1,
    status: 'found',
  });
  await refused('Sending back needs a comment', 'INVALID', 'POST', `/schemes/${up}/draft/send-back`, 'vikram', { comment: '' });
  await sendBack('vikram', up, 'The state G.O. may have a newer amount. Please check.');
  check(
    'Sent back: it is a draft again and the comment is logged',
    (await version(up, 1)).status === 'draft' && (await historyOf(up)).events.some((e) => e.action === 'sent_back' && !!e.comment),
  );

  // Two sources disagree: keep both values with their sources.
  await setField('neha', up, {
    field: 'benefit_amount',
    value: null,
    evidence: null,
    confidence: null,
    status: 'conflict',
    note: 'Portal and Government Order disagree',
    candidates: [
      { value: 1000, evidence: ev('Rs. 1,000 per month', 'Benefits section', upPortal) },
      { value: 1500, evidence: ev('pension revised to Rs. 1,500 per month', 'Para 4', upGO) },
    ],
  });
  rev = await submit('neha', up);
  await refused('A field where sources disagree blocks publishing', 'CONFLICT', 'POST', `/schemes/${up}/draft/publish`, 'vikram', { revision: rev });
  const revVikramSaw = rev;
  await sendBack('vikram', up, 'Use the value from the newer Government Order.');
  await setField('neha', up, {
    field: 'benefit_amount',
    value: 1500,
    evidence: ev('pension revised to Rs. 1,500 per month', 'Para 4', upGO),
    confidence: 0.85,
    status: 'found',
    note: 'The April 2026 G.O. is newer than the portal page',
  });
  rev = await submit('neha', up);
  await refused(
    'Approving an old revision is refused (the draft changed after it was reviewed)',
    'CONFLICT',
    'POST',
    `/schemes/${up}/draft/publish`,
    'vikram',
    { revision: revVikramSaw },
  );
  await publish('vikram', up, rev);
  check(
    'Vikram (a different person) publishes it; the read API serves ₹1,500',
    (await published(up)).version_no === 1 && (await amountOf(up)) === 1500,
  );

  // ---------------------------------------------------------------------------
  section('Rule 3: publishing locks a version; edits go into a new draft');
  const mh = 'SYN-MH-002';
  const mhGR = 'synthetic: Maharashtra WCD Government Resolution 2026-09 (PDF)';
  const draft = await startDraft('asha', mh);
  await setField('asha', mh, {
    field: 'benefit_amount',
    value: 30000,
    evidence: ev('grant enhanced to Rs. 30,000', 'Para 2', mhGR),
    confidence: 0.9,
    status: 'found',
  });
  await setField('asha', mh, {
    field: 'deadline',
    value: '2027-01-31',
    evidence: ev('last date extended to 31 January 2027', 'Para 5', mhGR),
    confidence: 0.9,
    status: 'found',
  });
  check(
    `While v${draft.version_no} is a draft, the read API still serves v1 with ₹25,000`,
    (await published(mh)).version_no === 1 && (await amountOf(mh)) === 25000,
  );
  await refused('Only one open draft per scheme', 'CONFLICT', 'POST', `/schemes/${mh}/draft`, 'ravi');
  await guardRefuses(
    'Updating published v1 directly through the model is refused',
    [
      () => SchemeVersionModel.updateOne({ scheme_ref: mh, version_no: 1, status: 'published' }, { $set: { 'fields.benefit_amount.value': 99999 } }),
      () => SchemeVersionModel.updateOne({ scheme_ref: mh, version_no: 1 }, { $set: { 'fields.benefit_amount.value': 99999 } }),
    ],
    async () => (await amountOf(mh)) === 25000,
  );

  console.log('  What the Central reviewer sees before approving:');
  for (const d of (await get<{ fields: { field: string; before: unknown; after: unknown; source: { source_ref: string } | null }[] }>(`/schemes/${mh}/diff`))
    .fields) {
    console.log(`        ${d.field}: ${JSON.stringify(d.before)} -> ${JSON.stringify(d.after)}  (source: ${d.source?.source_ref})`);
  }
  rev = await submit('asha', mh);
  await publish('meera', mh, rev);
  check('After approval the read API serves v2 with ₹30,000', (await published(mh)).version_no === 2 && (await amountOf(mh)) === 30000);
  const v1 = await version(mh, 1);
  check('v1 is kept, marked superseded, and still says ₹25,000', v1.status === 'superseded' && v1.fields.benefit_amount.value === 25000);

  // ---------------------------------------------------------------------------
  section('Rule 4: every field change is recorded (who, when, old, new, source)');
  const mhHistory = await historyOf(mh);
  const change = mhHistory.changes.find((c) => c.field === 'benefit_amount' && c.version_no === 2)!;
  console.log(`        ${change.changed_by} changed ${change.field} at ${change.changed_at}: ${change.old_value} -> ${change.new_value}`);
  console.log(`        source: ${JSON.stringify(change.source)}`);
  check(
    'The change shows asha, ₹25,000 -> ₹30,000 and the 2026-09 G.R. as source',
    change.changed_by === 'asha' && change.old_value === 25000 && change.new_value === 30000 && JSON.stringify(change.source).includes('2026-09'),
  );
  const actions = mhHistory.events.map((e) => `v${e.version_no}:${e.action}`);
  console.log(`        workflow events: ${actions.join(', ')}`);
  check('Workflow steps are logged too', actions.includes('v1:superseded') && actions.includes('v2:published'));
  await guardRefuses(
    'A history entry cannot be edited afterwards',
    [
      () => FieldChangeModel.updateOne({ scheme_ref: mh, version_no: 2, field: 'benefit_amount' }, { $set: { new_value: 1 } }),
      () => FieldChangeModel.deleteMany({ scheme_ref: mh }),
    ],
    async () => {
      const after = await historyOf(mh);
      const entry = after.changes.find((c) => c.field === 'benefit_amount' && c.version_no === 2);
      return after.changes.length === mhHistory.changes.length && entry?.new_value === 30000;
    },
  );

  // ---------------------------------------------------------------------------
  section('Principle: every fact points back to its source');
  const scratch = 'SYN-MH-006';
  await ok('POST', '/schemes', 'asha', { scheme_ref: scratch });
  const fieldsUrl = `/schemes/${scratch}/draft/fields`;
  await refused('A value without evidence is refused', 'INVALID', 'PUT', fieldsUrl, 'asha', {
    field: 'benefit_amount',
    value: 5000,
    evidence: null,
    confidence: 0.9,
    status: 'found',
  });
  await refused('"Not found" needs a reason', 'INVALID', 'PUT', fieldsUrl, 'asha', {
    field: 'deadline',
    value: null,
    evidence: null,
    confidence: null,
    status: 'not_found',
  });
  await refused('A conflict must keep every value with its source', 'INVALID', 'PUT', fieldsUrl, 'asha', {
    field: 'benefit_amount',
    value: null,
    evidence: null,
    confidence: null,
    status: 'conflict',
    candidates: [{ value: 5000, evidence: ev('Rs. 5,000', 'Para 1', 'synthetic: notice') }],
  });
  // Shared rules on a draft are part of its history too, including taking one off.
  await ok('PUT', `/schemes/${scratch}/draft/rules/RESIDENT_MH`, 'asha');
  const withoutRule = await ok<SchemeVersion>('DELETE', `/schemes/${scratch}/draft/rules/RESIDENT_MH`, 'asha');
  const removal = (await historyOf(scratch)).changes.find((c) => c.field === 'rule:RESIDENT_MH' && c.new_value === null);
  console.log(`        ${removal?.changed_by} changed ${removal?.field}: ${removal?.old_value} -> ${removal?.new_value}`);
  check(
    'Removing a shared rule from a draft is logged in history (v1 -> null)',
    !('RESIDENT_MH' in withoutRule.rules) && removal?.old_value === 'v1' && removal.changed_by === 'asha',
  );
  await ok('DELETE', `/schemes/${scratch}/draft`, 'asha');

  // ---------------------------------------------------------------------------
  section('Rule 5: changing a shared rule flags every scheme that uses it');
  const { flagged } = await ok<{ rule: RuleVersion; flagged: string[] }>('POST', '/rules/INCOME_BELOW_2_5L/versions', 'meera', {
    concept: 'annual_family_income',
    operator: '<',
    value: 300000,
    description: 'Annual family income below ₹3 lakh',
    evidence: ev('income limit revised to Rs. 3,00,000', 'Para 1', 'synthetic: Social Justice Dept circular 2026-10'),
  });
  console.log(`        flagged for review: ${flagged.join(', ')}`);
  check('All 3 schemes using the income rule are flagged; the farmer scheme is not', flagged.length === 3 && !flagged.includes('SYN-CEN-001'));

  const ka = 'SYN-KA-003';
  check('No silent change: SYN-KA-003 still serves the ₹2.5 lakh limit', (await incomeLimit(ka)) === 250000);
  await startDraft('ravi', ka);
  rev = await submit('ravi', ka);
  await refused('Publishing a draft that still uses the old rule version is blocked', 'CONFLICT', 'POST', `/schemes/${ka}/draft/publish`, 'vikram', {
    revision: rev,
  });
  await sendBack('vikram', ka, 'Adopt the revised income limit.');
  await ok('PUT', `/schemes/${ka}/draft/rules/INCOME_BELOW_2_5L`, 'ravi');
  console.log(`        diff: ${JSON.stringify((await get<{ rules: unknown }>(`/schemes/${ka}/diff`)).rules)}`);
  rev = await submit('ravi', ka);
  await publish('vikram', ka, rev);
  check(
    'After review and approval SYN-KA-003 serves ₹3 lakh and its flag is resolved',
    (await incomeLimit(ka)) === 300000 && (await get<ReviewFlag[]>(`/schemes/${ka}/flags`)).every((f) => f.status === 'resolved'),
  );

  const pensionFlag = (await get<ReviewFlag[]>('/schemes/SYN-KA-004/flags'))[0];
  await refused('Dismissing a flag needs a reason', 'INVALID', 'POST', `/flags/${pensionFlag.id}/dismiss`, 'meera', { note: '' });
  await ok('POST', `/flags/${pensionFlag.id}/dismiss`, 'meera', {
    note: 'Pension G.O. keeps its own ₹2.5 lakh limit; split into a separate rule later.',
  });
  check(
    'SYN-KA-004: flag dismissed with a reason, and it keeps the old rule version',
    (await get<ReviewFlag[]>('/schemes/SYN-KA-004/flags'))[0].status === 'dismissed' && (await incomeLimit('SYN-KA-004')) === 250000,
  );
  check('SYN-MH-002 is still waiting in the review queue', (await get<ReviewQueue>('/review-queue')).open_flags.some((f) => f.scheme_ref === mh));

  // ---------------------------------------------------------------------------
  section('MongoDB: two Central reviewers approve the same version at the same moment');
  const cen = 'SYN-CEN-001';
  await startDraft('asha', cen);
  await setField('asha', cen, {
    field: 'deadline',
    value: '2027-03-31',
    evidence: ev('enrolment for 2026-27 closes on 31 March 2027', 'Section 5', 'synthetic: Farmer Income Support circular 2026-10'),
    confidence: 0.8,
    status: 'found',
  });
  rev = await submit('asha', cen);
  const reviewers = ['meera', 'vikram'];
  const race = await Promise.all(reviewers.map((u) => call('POST', `/schemes/${cen}/draft/publish`, u, { revision: rev })));
  race.forEach((r, i) => {
    const e = r.body as ApiError;
    console.log(`        ${reviewers[i]}: ${r.status}${r.status === 200 ? ' (published)' : ` ${e.error}: ${e.message}`}`);
  });
  const codes = race.map((r) => r.status).sort();
  const publishedEvents = (await historyOf(cen)).events.filter((e) => e.action === 'published' && e.version_no === 2);
  check(
    'Exactly one approval wins (200) and the other gets 409; v2 is published once',
    codes[0] === 200 && codes[1] === 409 && publishedEvents.length === 1 && (await published(cen)).version_no === 2,
  );
}

try {
  await run();
} catch (err) {
  failed++;
  console.log(`  FAIL  The demo stopped early: ${err instanceof Error ? err.message : String(err)}`);
} finally {
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed) process.exitCode = 1;
  server.close();
  server.closeAllConnections();
  await disconnect(); // stops the in-memory MongoDB, so the process can exit
}
