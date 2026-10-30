// All the rules of the scheme knowledge base: drafts, review, publishing, change history and shared rules.
// Same rules and error messages as the first in-memory version (store.ts), now stored in MongoDB.
import mongoose from 'mongoose';
import {
  CounterModel,
  FieldChangeModel,
  HIDDEN,
  ReviewFlagModel,
  RuleVersionModel,
  SchemeModel,
  SchemeVersionModel,
  UserModel,
  WorkflowEventModel,
} from './models.ts';
import type {
  Diff,
  Evidence,
  FieldChange,
  FieldInput,
  FieldMeta,
  FieldRecord,
  FieldType,
  PublishedScheme,
  ReviewFlag,
  ReviewQueue,
  Role,
  RuleInput,
  RuleSummary,
  RuleVersion,
  SchemeSummary,
  SchemeVersion,
  User,
  VersionStatus,
  WorkflowAction,
  WorkflowEvent,
} from './types.ts';

export type ErrorCode = 'FORBIDDEN' | 'NOT_FOUND' | 'CONFLICT' | 'INVALID';

// An error the reviewer can act on. The API turns the code into an HTTP status and shows the message as-is.
export class KbError extends Error {
  code: ErrorCode;
  constructor(code: ErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}

const now = () => new Date().toISOString();
const isText = (v: unknown): v is string => typeof v === 'string' && v.trim() !== '';
const isTextList = (v: unknown) => Array.isArray(v) && v.length > 0 && v.every(isText);
const isDate = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v));
const OPEN: VersionStatus[] = ['draft', 'in_review'];

// ---------- field catalogue ----------

type FieldSpec = { type: FieldType; label: string; options?: string[]; valid: (v: unknown) => boolean };
const FREQUENCIES = ['one_time', 'monthly', 'yearly'];

// Fields a scheme can have, with a check for what a valid value looks like.
const FIELDS: Record<string, FieldSpec> = {
  name: { type: 'text', label: 'Scheme name', valid: isText },
  benefit_amount: { type: 'number', label: 'Benefit amount (INR)', valid: (v) => typeof v === 'number' && v >= 0 },
  benefit_frequency: { type: 'enum', label: 'Benefit frequency', options: FREQUENCIES, valid: (v) => FREQUENCIES.includes(v as string) },
  instalments: { type: 'integer', label: 'Number of instalments', valid: (v) => Number.isInteger(v) && (v as number) > 0 },
  deadline: { type: 'date', label: 'Application deadline', valid: isDate },
  required_documents: { type: 'text_list', label: 'Required documents', valid: isTextList },
  application_steps: { type: 'text_list', label: 'Application steps', valid: isTextList },
};

// Object.hasOwn, so names like "constructor" are not mistaken for fields.
const fieldSpec = (name: unknown) => (typeof name === 'string' && Object.hasOwn(FIELDS, name) ? FIELDS[name] : undefined);

// The field list for the reviewer UI, so it can draw the right input for each field.
export function meta(): { fields: FieldMeta[] } {
  return {
    fields: Object.entries(FIELDS).map(([name, s]) => ({ name, type: s.type, label: s.label, ...(s.options && { options: s.options }) })),
  };
}

// ---------- field records: every fact points back to its source ----------

// What a reviewer reads as "the value": the list of candidate values when sources disagree.
function valueOf(r: FieldRecord): unknown {
  return r.status === 'conflict' ? (r.candidates ?? []).map((c) => c.value) : r.value;
}

function isEvidence(e: unknown): e is Evidence {
  const x = e as Partial<Evidence> | null;
  return !!x && typeof x === 'object' && isText(x.text) && isText(x.location) && isText(x.source_ref) && isDate(x.captured_at);
}

// Keeps only the four evidence parts, in a fixed order.
const pickEvidence = (e: Evidence): Evidence => ({ text: e.text, location: e.location, source_ref: e.source_ref, captured_at: e.captured_at });

function checkEvidence(e: unknown, where: string): Evidence {
  if (!isEvidence(e)) throw new KbError('INVALID', `${where}: evidence needs text, location, source_ref and captured_at (YYYY-MM-DD)`);
  return pickEvidence(e);
}

// Principle: every fact points back to its source. No source means no value.
function toRecord(ref: string, input: FieldInput): FieldRecord {
  const r: FieldRecord = {
    scheme_ref: ref,
    field: input.field,
    value: input.value ?? null,
    evidence: null,
    confidence: input.confidence ?? null,
    status: input.status,
    note: input.note ?? null,
    candidates: null,
  };
  const spec = fieldSpec(r.field);
  if (!spec) throw new KbError('INVALID', `Unknown field "${r.field}"`);
  if (r.confidence !== null && (typeof r.confidence !== 'number' || r.confidence < 0 || r.confidence > 1)) {
    throw new KbError('INVALID', `${r.field}: confidence must be a number from 0 to 1`);
  }
  if (r.note !== null && typeof r.note !== 'string') throw new KbError('INVALID', `${r.field}: note must be text`);

  if (r.status === 'found') {
    if (!spec.valid(r.value)) throw new KbError('INVALID', `${r.field}: ${JSON.stringify(r.value)} is not a valid value`);
    r.evidence = checkEvidence(input.evidence, r.field);
    if (r.confidence === null) throw new KbError('INVALID', `${r.field}: a found value needs a confidence (0 to 1)`);
  } else if (r.status === 'not_found') {
    if (r.value !== null) throw new KbError('INVALID', `${r.field}: a not_found field must have an empty value`);
    if (!isText(r.note)) throw new KbError('INVALID', `${r.field}: say why it was not found (note)`);
    r.evidence = isEvidence(input.evidence) ? pickEvidence(input.evidence) : null; // optional here: kept only if complete
  } else if (r.status === 'conflict') {
    if (r.value !== null) throw new KbError('INVALID', `${r.field}: in a conflict, list the values in candidates and leave value empty`);
    const list = input.candidates;
    if (!Array.isArray(list) || list.length < 2) {
      throw new KbError('INVALID', `${r.field}: a conflict needs at least two candidates, each with its source`);
    }
    r.candidates = list.map((c, i) => {
      if (!spec.valid(c?.value)) throw new KbError('INVALID', `${r.field}: candidate ${i + 1} has an invalid value`);
      return { value: c.value, evidence: checkEvidence(c.evidence, `${r.field} candidate ${i + 1}`) };
    });
    r.evidence = isEvidence(input.evidence) ? pickEvidence(input.evidence) : null; // the sources are in candidates
  } else {
    throw new KbError('INVALID', `${r.field}: status must be found, not_found or conflict`);
  }
  return r;
}

// ---------- transactions ----------

// Readable messages for the unique indexes in models.ts. They only fire when two requests race each other.
const DUPLICATE_MESSAGES: Record<string, (key: Record<string, unknown>) => string> = {
  scheme_ref_unique: (k) => `Scheme "${k.scheme_ref}" already exists`,
  one_open_version_per_scheme: (k) => `${k.scheme_ref} already has an open draft. Finish or discard it first.`,
  one_published_per_scheme: (k) => `${k.scheme_ref} already has a published version`,
  version_no_unique: (k) => `${k.scheme_ref} was changed by someone else at the same moment. Reload and try again.`,
  rule_version_unique: (k) => `Rule "${k.code}" was changed by someone else at the same moment. Reload and try again.`,
  one_open_flag_per_rule: (k) => `${k.scheme_ref} was flagged by someone else at the same moment. Reload and try again.`,
};

// MongoDB duplicate-key error (code 11000) -> 409 CONFLICT with a readable message.
function toKbError(err: unknown): unknown {
  const e = err as { code?: unknown; message?: string; keyValue?: Record<string, unknown> } | null;
  if (err instanceof KbError || e?.code !== 11000) return err;
  const index = /index: (\S+)/.exec(e.message ?? '')?.[1] ?? '';
  const message = Object.hasOwn(DUPLICATE_MESSAGES, index)
    ? DUPLICATE_MESSAGES[index](e.keyValue ?? {})
    : 'Someone else changed this at the same moment. Reload and try again.';
  return new KbError('CONFLICT', message);
}

// Runs fn as one MongoDB transaction: all its writes are saved together, or none are.
// If another request changes the same documents at the same moment, MongoDB aborts one of them and
// runs it again from the start, so it re-checks every rule against the new state.
async function inTransaction<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await mongoose.connection.transaction(fn);
  } catch (err) {
    throw toKbError(err);
  }
}

// ---------- helpers ----------

// Rule 1: check the person has the role this action needs.
async function actor(userId: string, role: Role): Promise<User> {
  if (!isText(userId)) throw new KbError('FORBIDDEN', 'Missing X-User-Id header: say who is making this change');
  const user = await UserModel.findOne({ id: userId }, HIDDEN).lean<User>();
  if (!user) throw new KbError('FORBIDDEN', `Unknown user "${userId}"`);
  if (!user.roles.includes(role)) throw new KbError('FORBIDDEN', `${user.name} is not a ${role}`);
  return user;
}

async function ensureScheme(ref: string) {
  if (!(await SchemeModel.exists({ scheme_ref: ref }))) throw new KbError('NOT_FOUND', `No scheme "${ref}"`);
}

const findVersion = (filter: Record<string, unknown>) => SchemeVersionModel.findOne(filter, HIDDEN).lean<SchemeVersion>();
const liveVersion = (ref: string) => findVersion({ scheme_ref: ref, status: 'published' });
const openVersion = (ref: string) => findVersion({ scheme_ref: ref, status: { $in: OPEN } });

// The version as it is now stored (inside a transaction this includes the transaction's own writes).
async function reload(v: SchemeVersion): Promise<SchemeVersion> {
  return (await findVersion({ scheme_ref: v.scheme_ref, version_no: v.version_no }))!;
}

// The draft a State reviewer may edit right now.
async function editableDraft(ref: string): Promise<SchemeVersion> {
  await ensureScheme(ref);
  const v = await openVersion(ref);
  if (!v) throw new KbError('CONFLICT', `${ref} has no open draft. Start one first.`);
  if (v.status !== 'draft') {
    throw new KbError('CONFLICT', `${ref} v${v.version_no} is in review and cannot be edited. A Central reviewer must send it back first.`);
  }
  return v;
}

async function inReview(ref: string): Promise<SchemeVersion> {
  await ensureScheme(ref);
  const v = await openVersion(ref);
  if (!v || v.status !== 'in_review') throw new KbError('CONFLICT', `${ref} has no version in review`);
  return v;
}

async function latestRule(code: string): Promise<RuleVersion> {
  const rule = await RuleVersionModel.findOne({ code }, HIDDEN).sort({ version_no: -1 }).lean<RuleVersion>();
  if (!rule) throw new KbError('NOT_FOUND', `No shared rule "${code}"`);
  return rule;
}

const openFlags = (ref: string) => ReviewFlagModel.find({ scheme_ref: ref, status: 'open' }, HIDDEN).sort({ id: 1 }).lean<ReviewFlag[]>();

async function log(v: SchemeVersion, action: WorkflowAction, by: string, comment: string | null = null) {
  await WorkflowEventModel.create({ scheme_ref: v.scheme_ref, version_no: v.version_no, action, by, at: now(), comment });
}

// Rule 4: every field change is kept (field_changes is append-only, see models.ts).
async function recordChange(v: SchemeVersion, field: string, oldValue: unknown, newValue: unknown, source: unknown, by: string) {
  await FieldChangeModel.create({
    scheme_ref: v.scheme_ref,
    version_no: v.version_no,
    field,
    old_value: oldValue,
    new_value: newValue,
    source,
    changed_by: by,
    changed_at: now(),
  });
}

// Changes a draft's content and counts it as an edit: revision + 1, and the user joins the editors.
// The filter pins status 'draft' and the revision we read, so a draft that moved on meanwhile is left alone.
async function editDraft(v: SchemeVersion, userId: string, change: Record<string, unknown>) {
  const res = await SchemeVersionModel.updateOne(
    { scheme_ref: v.scheme_ref, version_no: v.version_no, status: 'draft', revision: v.revision },
    { ...change, $inc: { revision: 1 }, $addToSet: { editors: userId } },
  );
  if (res.matchedCount !== 1) throw new KbError('CONFLICT', `${v.scheme_ref} was changed by someone else at the same moment. Reload and try again.`);
}

// Moves a version to a new status, but only if it is still in the status (and revision) we checked.
// If two requests race, the second one matches nothing and gets 409 instead of overwriting the first.
async function moveStatus(v: SchemeVersion, from: VersionStatus, to: VersionStatus, extra: Record<string, unknown> = {}) {
  const res = await SchemeVersionModel.updateOne(
    { scheme_ref: v.scheme_ref, version_no: v.version_no, status: from, revision: v.revision },
    { $set: { status: to, ...extra } },
  );
  if (res.matchedCount !== 1) {
    throw new KbError('CONFLICT', `${v.scheme_ref} v${v.version_no} was changed by someone else at the same moment. Reload and try again.`);
  }
}

// Next number in a named sequence (MongoDB has no auto-increment, so a counter document keeps the last number).
async function nextId(name: string): Promise<number> {
  const counter = await CounterModel.findOneAndUpdate({ _id: name }, { $inc: { seq: 1 } }, { upsert: true, returnDocument: 'after' }).lean<{
    seq: number;
  }>();
  return counter!.seq;
}

// "12" -> 12; anything that is not a whole positive number -> null.
function asInt(v: unknown): number | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' && /^\d+$/.test(v) ? Number(v) : NaN;
  return Number.isInteger(n) && n > 0 ? n : null;
}

// All scheme refs, oldest scheme first.
async function allSchemeRefs(): Promise<string[]> {
  const schemes = await SchemeModel.find({}, { scheme_ref: 1 }).sort({ _id: 1 }).lean<{ scheme_ref: string }[]>();
  return schemes.map((s) => s.scheme_ref);
}

// Sorts items into the order their schemes were created in.
function inSchemeOrder<T extends { scheme_ref: string }>(items: T[], refs: string[]): T[] {
  const rank = new Map(refs.map((ref, i) => [ref, i]));
  return [...items].sort((a, b) => (rank.get(a.scheme_ref) ?? 0) - (rank.get(b.scheme_ref) ?? 0));
}

// ---------- users ----------

export async function addUser(user: User): Promise<User> {
  await UserModel.create(user);
  return user;
}

export async function listUsers(): Promise<User[]> {
  return UserModel.find({}, HIDDEN).sort({ _id: 1 }).lean<User[]>();
}

// ---------- Rules 1-3: drafts, review and publishing ----------

export function createScheme(userId: string, ref: unknown): Promise<SchemeVersion> {
  return inTransaction(async () => {
    const user = await actor(userId, 'STATE_REVIEWER');
    if (!isText(ref)) throw new KbError('INVALID', 'scheme_ref is required');
    if (await SchemeModel.exists({ scheme_ref: ref })) throw new KbError('CONFLICT', `Scheme "${ref}" already exists`);
    const at = now();
    await SchemeModel.create({ scheme_ref: ref, created_at: at });
    const v: SchemeVersion = {
      scheme_ref: ref,
      version_no: 1,
      status: 'draft',
      based_on: null,
      created_by: user.id,
      created_at: at,
      editors: [user.id],
      revision: 0,
      fields: {},
      rules: {},
      published_by: null,
      published_at: null,
    };
    await SchemeVersionModel.create(v);
    await log(v, 'created', user.id);
    return reload(v);
  });
}

// Rule 3: editing a live scheme starts a new draft. The published version is not touched.
export function startDraft(userId: string, ref: string): Promise<SchemeVersion> {
  return inTransaction(async () => {
    const user = await actor(userId, 'STATE_REVIEWER');
    await ensureScheme(ref);
    const existing = await openVersion(ref);
    if (existing) throw new KbError('CONFLICT', `${ref} already has an open draft (v${existing.version_no}). Finish or discard it first.`);
    const live = await liveVersion(ref);
    if (!live) throw new KbError('CONFLICT', `${ref} has nothing published to start from`);
    const v: SchemeVersion = {
      scheme_ref: ref,
      version_no: (await SchemeVersionModel.countDocuments({ scheme_ref: ref })) + 1,
      status: 'draft',
      based_on: live.version_no,
      created_by: user.id,
      created_at: now(),
      editors: [user.id],
      revision: 0,
      fields: live.fields, // copied into a new document; the published one is not changed
      rules: live.rules,
      published_by: null,
      published_at: null,
    };
    await SchemeVersionModel.create(v);
    await log(v, 'draft_started', user.id);
    return reload(v);
  });
}

export function setField(userId: string, ref: string, input: FieldInput): Promise<FieldRecord> {
  return inTransaction(async () => {
    const user = await actor(userId, 'STATE_REVIEWER');
    const v = await editableDraft(ref);
    const record = toRecord(ref, input);
    const old = v.fields[record.field];
    await editDraft(v, user.id, { $set: { [`fields.${record.field}`]: record } });
    const source = record.status === 'conflict' ? record.candidates!.map((c) => c.evidence) : record.evidence;
    await recordChange(v, record.field, old ? valueOf(old) : null, valueOf(record), source, user.id);
    return record;
  });
}

// Attach a shared rule to the draft, at the rule's latest version.
export function useRule(userId: string, ref: string, code: string): Promise<SchemeVersion> {
  return inTransaction(async () => {
    const user = await actor(userId, 'STATE_REVIEWER');
    const v = await editableDraft(ref);
    const rule = await latestRule(code);
    const old = Object.hasOwn(v.rules, code) ? v.rules[code] : null;
    if (old === rule.version_no) return v;
    await editDraft(v, user.id, { $set: { [`rules.${code}`]: rule.version_no } });
    await recordChange(v, `rule:${code}`, old === null ? null : `v${old}`, `v${rule.version_no}`, rule.evidence, user.id);
    return reload(v);
  });
}

// Take a shared rule off the draft. Logged like a field change: "rule:CODE" from "vN" to null.
export function removeRule(userId: string, ref: string, code: string): Promise<SchemeVersion> {
  return inTransaction(async () => {
    const user = await actor(userId, 'STATE_REVIEWER');
    const v = await editableDraft(ref);
    if (!Object.hasOwn(v.rules, code)) throw new KbError('NOT_FOUND', `${ref} v${v.version_no} does not use the shared rule "${code}"`);
    const old = v.rules[code];
    await editDraft(v, user.id, { $unset: { [`rules.${code}`]: 1 } });
    await recordChange(v, `rule:${code}`, `v${old}`, null, null, user.id);
    return reload(v);
  });
}

export function submit(userId: string, ref: string): Promise<SchemeVersion> {
  return inTransaction(async () => {
    const user = await actor(userId, 'STATE_REVIEWER');
    const v = await editableDraft(ref);
    if (v.fields.name?.status !== 'found') throw new KbError('INVALID', `${ref}: add the scheme name before submitting`);
    await moveStatus(v, 'draft', 'in_review');
    await log(v, 'submitted', user.id);
    return reload(v);
  });
}

export function sendBack(userId: string, ref: string, comment: unknown): Promise<SchemeVersion> {
  return inTransaction(async () => {
    const user = await actor(userId, 'CENTRAL_REVIEWER');
    const v = await inReview(ref);
    if (!isText(comment)) throw new KbError('INVALID', 'Sending back needs a comment saying what to fix');
    await moveStatus(v, 'in_review', 'draft');
    await log(v, 'sent_back', user.id, comment);
    return reload(v);
  });
}

// Approve and publish. `revision` is the revision the Central reviewer looked at.
export function publish(userId: string, ref: string, revision: unknown): Promise<SchemeVersion> {
  return inTransaction(async () => {
    const user = await actor(userId, 'CENTRAL_REVIEWER');
    const v = await inReview(ref);
    if (v.editors.includes(user.id)) {
      throw new KbError('FORBIDDEN', `${user.name} created or edited ${ref} v${v.version_no}, so someone else must approve it`);
    }
    if (typeof revision !== 'number') throw new KbError('INVALID', 'Send the revision you reviewed (a number) to publish');
    if (revision !== v.revision) {
      throw new KbError('CONFLICT', `${ref} changed since you reviewed it (you saw revision ${revision}, it is now ${v.revision}). Review it again.`);
    }
    const conflicts = Object.values(v.fields).filter((f) => f.status === 'conflict').map((f) => f.field);
    if (conflicts.length) {
      throw new KbError('CONFLICT', `Sources disagree on ${conflicts.join(', ')}. Pick one value before publishing.`);
    }
    // An open flag blocks publishing while the draft still uses an older version of that rule.
    const stale = (await openFlags(ref)).filter((f) => Object.hasOwn(v.rules, f.rule_code) && v.rules[f.rule_code] < f.to_version);
    if (stale.length) {
      const list = stale.map((f) => `${f.rule_code} (v${v.rules[f.rule_code]} -> v${f.to_version})`).join(', ');
      throw new KbError('CONFLICT', `Shared rule changed: ${list}. Update the rule in this draft, or dismiss the flag with a reason.`);
    }

    // The old published version is superseded first: the index allows only one published version per scheme.
    const live = await liveVersion(ref);
    if (live) {
      await moveStatus(live, 'published', 'superseded'); // kept for history, no longer served
      await log(live, 'superseded', user.id);
    }
    await moveStatus(v, 'in_review', 'published', { published_by: user.id, published_at: now() });
    await ReviewFlagModel.updateMany(
      { scheme_ref: ref, status: 'open' },
      { $set: { status: 'resolved', closed_by: user.id, closed_note: `Reviewed and published in v${v.version_no}` } },
    );
    await log(v, 'published', user.id);
    return reload(v);
  });
}

export function discardDraft(userId: string, ref: string): Promise<SchemeVersion> {
  return inTransaction(async () => {
    const user = await actor(userId, 'STATE_REVIEWER');
    const v = await editableDraft(ref);
    await moveStatus(v, 'draft', 'discarded');
    await log(v, 'discarded', user.id);
    return reload(v);
  });
}

// ---------- Rule 5: shared eligibility rules ----------

const RULE_CODE = /^[A-Za-z0-9_]+$/; // the code is used as a key inside scheme versions, so keep it simple

function makeRule(userId: string, code: string, version_no: number, input: RuleInput): RuleVersion {
  const i = (input ?? {}) as Partial<RuleInput>;
  if (!isText(i.concept) || !isText(i.operator) || i.value === undefined || !isText(i.description)) {
    throw new KbError('INVALID', `Rule ${code} needs concept, operator, value and description`);
  }
  const evidence = checkEvidence(i.evidence, `rule ${code}`);
  return { code, version_no, concept: i.concept, operator: i.operator, value: i.value, description: i.description, evidence, changed_by: userId, changed_at: now() };
}

export function createRule(userId: string, code: unknown, input: RuleInput): Promise<RuleVersion> {
  return inTransaction(async () => {
    const user = await actor(userId, 'CENTRAL_REVIEWER');
    if (!isText(code) || !RULE_CODE.test(code)) throw new KbError('INVALID', 'A rule needs a code made of letters, digits and _ (e.g. AGE_60_PLUS)');
    if (await RuleVersionModel.exists({ code })) throw new KbError('CONFLICT', `Rule "${code}" already exists`);
    const rule = makeRule(user.id, code, 1, input);
    await RuleVersionModel.create(rule);
    return rule;
  });
}

// Changing a shared rule adds a new rule version. Every scheme keeps the rule version it was
// approved with, and each scheme that uses the rule gets a review flag.
export function changeRule(userId: string, code: string, input: RuleInput): Promise<{ rule: RuleVersion; flagged: string[] }> {
  return inTransaction(async () => {
    const user = await actor(userId, 'CENTRAL_REVIEWER');
    const latest = await latestRule(code); // throws if the rule does not exist
    const rule = makeRule(user.id, code, latest.version_no + 1, input);
    await RuleVersionModel.create(rule);
    const flagged = await flagSchemesUsing(rule);
    return { rule, flagged };
  });
}

// One open flag per scheme whose draft, in-review or published version uses the rule.
async function flagSchemesUsing(rule: RuleVersion): Promise<string[]> {
  const versions = await SchemeVersionModel.find(
    { status: { $in: ['draft', 'in_review', 'published'] }, [`rules.${rule.code}`]: { $exists: true } },
    HIDDEN,
  ).lean<SchemeVersion[]>();
  const pinned = new Map<string, number[]>(); // scheme_ref -> rule versions its current versions use
  for (const v of versions) pinned.set(v.scheme_ref, [...(pinned.get(v.scheme_ref) ?? []), v.rules[rule.code]]);
  const refs = (await allSchemeRefs()).filter((ref) => pinned.has(ref));

  for (const ref of refs) {
    const existing = await ReviewFlagModel.findOne({ scheme_ref: ref, rule_code: rule.code, status: 'open' }, HIDDEN).lean<ReviewFlag>();
    if (existing) {
      // the rule changed again before anyone reviewed the scheme
      await ReviewFlagModel.updateOne({ id: existing.id, status: 'open' }, { $set: { to_version: rule.version_no } });
    } else {
      await ReviewFlagModel.create({
        id: await nextId('review_flags'),
        scheme_ref: ref,
        rule_code: rule.code,
        from_version: Math.min(...pinned.get(ref)!),
        to_version: rule.version_no,
        status: 'open',
        created_at: now(),
        closed_by: null,
        closed_note: null,
      });
    }
  }
  return refs;
}

// A Central reviewer decides a flagged scheme should keep the old rule version. A reason is required.
export function dismissFlag(userId: string, id: unknown, note: unknown): Promise<ReviewFlag> {
  return inTransaction(async () => {
    const user = await actor(userId, 'CENTRAL_REVIEWER');
    const n = asInt(id);
    const flag = n ? await ReviewFlagModel.findOne({ id: n }, HIDDEN).lean<ReviewFlag>() : null;
    if (!flag) throw new KbError('NOT_FOUND', `No flag ${id}`);
    if (flag.status !== 'open') throw new KbError('CONFLICT', `Flag ${id} is already ${flag.status}`);
    if (!isText(note)) throw new KbError('INVALID', 'Dismissing a flag needs a reason');
    await ReviewFlagModel.updateOne({ id: flag.id, status: 'open' }, { $set: { status: 'dismissed', closed_by: user.id, closed_note: note } });
    return (await ReviewFlagModel.findOne({ id: flag.id }, HIDDEN).lean<ReviewFlag>())!;
  });
}

export async function listRules(): Promise<RuleSummary[]> {
  const all = await RuleVersionModel.find({}, HIDDEN).sort({ _id: 1 }).lean<RuleVersion[]>();
  const byCode = new Map<string, RuleVersion[]>(); // keeps the order rules were created in
  for (const r of all) byCode.set(r.code, [...(byCode.get(r.code) ?? []), r]);
  return [...byCode].map(([code, versions]) => ({ code, versions: versions.sort((a, b) => a.version_no - b.version_no) }));
}

// ---------- Read API: only ever serves the published version ----------

// Rule versions for (code, version) pairs, in one query. Key: "CODE@2".
async function rulesAt(pairs: [string, number][]): Promise<Map<string, RuleVersion>> {
  if (!pairs.length) return new Map();
  const found = await RuleVersionModel.find({ $or: pairs.map(([code, version_no]) => ({ code, version_no })) }, HIDDEN).lean<RuleVersion[]>();
  return new Map(found.map((r) => [`${r.code}@${r.version_no}`, r]));
}

function toPublished(v: SchemeVersion, rules: Map<string, RuleVersion>): PublishedScheme {
  return {
    scheme_ref: v.scheme_ref,
    version_no: v.version_no,
    published_at: v.published_at!,
    published_by: v.published_by!,
    fields: Object.values(v.fields),
    // each rule at the exact version this scheme version was approved with
    eligibility: Object.entries(v.rules).map(([code, no]) => rules.get(`${code}@${no}`)!),
  };
}

export async function getPublished(ref: string): Promise<PublishedScheme> {
  await ensureScheme(ref);
  const v = await liveVersion(ref);
  if (!v) throw new KbError('NOT_FOUND', `${ref} has no published version yet`);
  return toPublished(v, await rulesAt(Object.entries(v.rules)));
}

export async function listPublished(): Promise<PublishedScheme[]> {
  const live = await SchemeVersionModel.find({ status: 'published' }, HIDDEN).lean<SchemeVersion[]>();
  const rules = await rulesAt(live.flatMap((v) => Object.entries(v.rules)));
  return inSchemeOrder(live, await allSchemeRefs()).map((v) => toPublished(v, rules));
}

// ---------- Reviewer views ----------

const nameOf = (v: SchemeVersion | undefined) => (v?.fields.name?.status === 'found' ? String(v.fields.name.value) : null);

// One line per scheme (published or not) for the reviewer dashboard.
export async function staffSchemes(): Promise<SchemeSummary[]> {
  const refs = await allSchemeRefs();
  const current = await SchemeVersionModel.find({ status: { $in: [...OPEN, 'published'] } }, HIDDEN).lean<SchemeVersion[]>();
  const open = new Map(current.filter((v) => OPEN.includes(v.status)).map((v) => [v.scheme_ref, v]));
  const live = new Map(current.filter((v) => v.status === 'published').map((v) => [v.scheme_ref, v]));
  const flags = await ReviewFlagModel.find({ status: 'open' }, { scheme_ref: 1 }).lean<{ scheme_ref: string }[]>();
  const flagCount = new Map<string, number>();
  for (const f of flags) flagCount.set(f.scheme_ref, (flagCount.get(f.scheme_ref) ?? 0) + 1);

  return refs.map((ref) => {
    const o = open.get(ref);
    return {
      scheme_ref: ref,
      name: nameOf(o) ?? nameOf(live.get(ref)),
      published_version: live.get(ref)?.version_no ?? null,
      open_version: o
        ? { version_no: o.version_no, status: o.status as 'draft' | 'in_review', revision: o.revision, created_by: o.created_by }
        : null,
      open_flags: flagCount.get(ref) ?? 0,
    };
  });
}

export async function listVersions(ref: string): Promise<SchemeVersion[]> {
  await ensureScheme(ref);
  return SchemeVersionModel.find({ scheme_ref: ref }, HIDDEN).sort({ version_no: 1 }).lean<SchemeVersion[]>();
}

export async function getVersion(ref: string, no: unknown): Promise<SchemeVersion> {
  await ensureScheme(ref);
  const n = asInt(no);
  const v = n ? await findVersion({ scheme_ref: ref, version_no: n }) : null;
  if (!v) throw new KbError('NOT_FOUND', `${ref} has no version ${no}`);
  return v;
}

export async function history(ref: string): Promise<{ changes: FieldChange[]; events: WorkflowEvent[] }> {
  await ensureScheme(ref);
  return {
    changes: await FieldChangeModel.find({ scheme_ref: ref }, HIDDEN).sort({ _id: 1 }).lean<FieldChange[]>(),
    events: await WorkflowEventModel.find({ scheme_ref: ref }, HIDDEN).sort({ _id: 1 }).lean<WorkflowEvent[]>(),
  };
}

const sameJson = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

// Before-and-after of the open draft against the published version.
export async function diff(ref: string): Promise<Diff> {
  await ensureScheme(ref);
  const draft = await openVersion(ref);
  if (!draft) throw new KbError('CONFLICT', `${ref} has no open draft to compare`);
  const live = await liveVersion(ref);

  const before: Record<string, FieldRecord> = live?.fields ?? {};
  const names = [...new Set([...Object.keys(before), ...Object.keys(draft.fields)])];
  const fields = names
    .filter((n) => !sameJson(before[n], draft.fields[n]))
    .map((n) => ({
      field: n,
      before: before[n] ? valueOf(before[n]) : null,
      after: draft.fields[n] ? valueOf(draft.fields[n]) : null,
      source: draft.fields[n]?.evidence ?? null,
    }));

  const liveRules: Record<string, number> = live?.rules ?? {};
  const codes = [...new Set([...Object.keys(liveRules), ...Object.keys(draft.rules)])];
  const rules = codes
    .filter((c) => liveRules[c] !== draft.rules[c])
    .map((c) => ({ rule: c, before: liveRules[c] ?? null, after: draft.rules[c] ?? null }));

  return { scheme_ref: ref, published_version: live?.version_no ?? null, draft_version: draft.version_no, fields, rules };
}

export async function flagsFor(ref: string): Promise<ReviewFlag[]> {
  await ensureScheme(ref);
  return ReviewFlagModel.find({ scheme_ref: ref }, HIDDEN).sort({ id: 1 }).lean<ReviewFlag[]>();
}

// What Central reviewers need to look at.
export async function reviewQueue(): Promise<ReviewQueue> {
  const versions = await SchemeVersionModel.find({ status: 'in_review' }, HIDDEN).lean<SchemeVersion[]>();
  const in_review = inSchemeOrder(versions, await allSchemeRefs()).map((v) => ({
    scheme_ref: v.scheme_ref,
    version_no: v.version_no,
    revision: v.revision,
    created_by: v.created_by,
  }));
  const open_flags = await ReviewFlagModel.find({ status: 'open' }, HIDDEN).sort({ id: 1 }).lean<ReviewFlag[]>();
  return { in_review, open_flags };
}
