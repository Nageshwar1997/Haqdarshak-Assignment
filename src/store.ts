// Scheme Knowledge Base: drafts, review, publishing, change history and shared eligibility rules.
// Data lives in memory (no database) so the project runs with plain `node` and no install.

export type Role = 'STATE_REVIEWER' | 'CENTRAL_REVIEWER';
export type User = { id: string; name: string; roles: Role[] };

export type Evidence = {
  text: string; // exact text the value came from
  location: string; // page or section in the source
  source_ref: string; // link, or a placeholder name for a synthetic source
  captured_at: string; // date it was captured (YYYY-MM-DD)
};

export type FieldStatus = 'found' | 'not_found' | 'conflict';

// One scheme field, in the format the brief asks for.
export type FieldRecord = {
  scheme_ref: string;
  field: string;
  value: unknown; // null when not found or in conflict
  evidence: Evidence | null;
  confidence: number | null; // 0 to 1
  status: FieldStatus;
  note?: string;
  candidates?: { value: unknown; evidence: Evidence }[]; // conflict only: every value with its source
};

export type FieldInput = Omit<FieldRecord, 'scheme_ref'>;

export type VersionStatus = 'draft' | 'in_review' | 'published' | 'superseded' | 'discarded';

export type SchemeVersion = {
  scheme_ref: string;
  version_no: number;
  status: VersionStatus;
  based_on: number | null; // the published version this draft was copied from
  created_by: string;
  created_at: string;
  editors: string[]; // everyone who changed something in this version
  revision: number; // goes up on every edit, so an approval is tied to what the reviewer saw
  fields: Record<string, FieldRecord>;
  rules: Record<string, number>; // shared rule code -> the rule version this scheme version uses
  published_by?: string;
  published_at?: string;
};

export type RuleInput = { concept: string; operator: string; value: unknown; description: string; evidence: Evidence };
export type RuleVersion = RuleInput & { code: string; version_no: number; changed_by: string; changed_at: string };

export type FieldChange = {
  scheme_ref: string;
  version_no: number;
  field: string;
  old_value: unknown;
  new_value: unknown;
  source: unknown;
  changed_by: string;
  changed_at: string;
};

export type WorkflowEvent = { scheme_ref: string; version_no: number; action: string; by: string; at: string; comment?: string };

export type ReviewFlag = {
  id: number;
  scheme_ref: string;
  rule_code: string;
  from_version: number;
  to_version: number;
  status: 'open' | 'resolved' | 'dismissed';
  created_at: string;
  closed_by?: string;
  closed_note?: string;
};

export type ErrorCode = 'FORBIDDEN' | 'NOT_FOUND' | 'CONFLICT' | 'INVALID';

export class KbError extends Error {
  code: ErrorCode;
  constructor(code: ErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}

const now = () => new Date().toISOString();
const isText = (v: unknown) => typeof v === 'string' && v.trim() !== '';
const isTextList = (v: unknown) => Array.isArray(v) && v.length > 0 && v.every(isText);
const isDate = (v: unknown) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v));

// Fields a scheme can have, with a check for what a valid value looks like.
export const FIELDS: Record<string, (v: unknown) => boolean> = {
  name: isText,
  benefit_amount: (v) => typeof v === 'number' && v >= 0, // in INR
  benefit_frequency: (v) => v === 'one_time' || v === 'monthly' || v === 'yearly',
  instalments: (v) => Number.isInteger(v) && (v as number) > 0,
  deadline: isDate,
  required_documents: isTextList,
  application_steps: isTextList,
};

// Freeze an object and everything inside it. Any later change throws an error.
function deepFreeze<T>(obj: T): T {
  if (obj && typeof obj === 'object' && !Object.isFrozen(obj)) {
    Object.freeze(obj);
    for (const v of Object.values(obj)) deepFreeze(v);
  }
  return obj;
}

// What a reviewer reads as "the value": the list of candidate values when sources disagree.
function valueOf(r: FieldRecord): unknown {
  return r.status === 'conflict' ? (r.candidates ?? []).map((c) => c.value) : r.value;
}

function checkEvidence(e: Evidence | null | undefined, where: string) {
  if (!e || !isText(e.text) || !isText(e.location) || !isText(e.source_ref) || !isDate(e.captured_at)) {
    throw new KbError('INVALID', `${where}: evidence needs text, location, source_ref and captured_at (YYYY-MM-DD)`);
  }
}

// Principle: every fact points back to its source. No source means no value.
function toRecord(ref: string, input: FieldInput): FieldRecord {
  const r: FieldRecord = {
    scheme_ref: ref,
    field: input.field,
    value: input.value ?? null,
    evidence: input.evidence ?? null,
    confidence: input.confidence ?? null,
    status: input.status,
    note: input.note,
    candidates: input.candidates,
  };
  const valid = FIELDS[r.field];
  if (!valid) throw new KbError('INVALID', `Unknown field "${r.field}"`);
  if (r.confidence !== null && (typeof r.confidence !== 'number' || r.confidence < 0 || r.confidence > 1)) {
    throw new KbError('INVALID', `${r.field}: confidence must be a number from 0 to 1`);
  }
  if (r.status === 'found') {
    if (!valid(r.value)) throw new KbError('INVALID', `${r.field}: ${JSON.stringify(r.value)} is not a valid value`);
    checkEvidence(r.evidence, r.field);
    if (r.confidence === null) throw new KbError('INVALID', `${r.field}: a found value needs a confidence (0 to 1)`);
    delete r.candidates;
  } else if (r.status === 'not_found') {
    if (r.value !== null) throw new KbError('INVALID', `${r.field}: a not_found field must have an empty value`);
    if (!isText(r.note)) throw new KbError('INVALID', `${r.field}: say why it was not found (note)`);
    delete r.candidates;
  } else if (r.status === 'conflict') {
    if (r.value !== null) throw new KbError('INVALID', `${r.field}: in a conflict, list the values in candidates and leave value empty`);
    if (!Array.isArray(r.candidates) || r.candidates.length < 2) {
      throw new KbError('INVALID', `${r.field}: a conflict needs at least two candidates, each with its source`);
    }
    r.candidates.forEach((c, i) => {
      if (!valid(c.value)) throw new KbError('INVALID', `${r.field}: candidate ${i + 1} has an invalid value`);
      checkEvidence(c.evidence, `${r.field} candidate ${i + 1}`);
    });
  } else {
    throw new KbError('INVALID', `${r.field}: status must be found, not_found or conflict`);
  }
  return r;
}

export class KnowledgeBase {
  private users = new Map<string, User>();
  private schemes = new Map<string, SchemeVersion[]>(); // scheme_ref -> all its versions, oldest first
  private rules = new Map<string, RuleVersion[]>(); // rule code -> all its versions, oldest first
  private changes: FieldChange[] = [];
  private events: WorkflowEvent[] = [];
  private flags: ReviewFlag[] = [];

  addUser(user: User) {
    this.users.set(user.id, user);
  }

  // ---------- helpers ----------

  // Rule 1: check the person has the role this action needs.
  private actor(userId: string, role: Role): User {
    const user = this.users.get(userId);
    if (!user) throw new KbError('FORBIDDEN', `Unknown user "${userId}"`);
    if (!user.roles.includes(role)) throw new KbError('FORBIDDEN', `${user.name} is not a ${role}`);
    return user;
  }

  private versionsOf(ref: string): SchemeVersion[] {
    const list = this.schemes.get(ref);
    if (!list) throw new KbError('NOT_FOUND', `No scheme "${ref}"`);
    return list;
  }

  private live(ref: string) {
    return this.versionsOf(ref).find((v) => v.status === 'published');
  }

  private open(ref: string) {
    return this.versionsOf(ref).find((v) => v.status === 'draft' || v.status === 'in_review');
  }

  // The draft a State reviewer may edit right now.
  private editableDraft(ref: string): SchemeVersion {
    const v = this.open(ref);
    if (!v) throw new KbError('CONFLICT', `${ref} has no open draft. Start one first.`);
    if (v.status !== 'draft') {
      throw new KbError('CONFLICT', `${ref} v${v.version_no} is in review and cannot be edited. A Central reviewer must send it back first.`);
    }
    return v;
  }

  private inReview(ref: string): SchemeVersion {
    const v = this.open(ref);
    if (!v || v.status !== 'in_review') throw new KbError('CONFLICT', `${ref} has no version in review`);
    return v;
  }

  private latestRule(code: string): RuleVersion {
    const list = this.rules.get(code);
    if (!list) throw new KbError('NOT_FOUND', `No shared rule "${code}"`);
    return list[list.length - 1];
  }

  private openFlags(ref: string) {
    return this.flags.filter((f) => f.status === 'open' && f.scheme_ref === ref);
  }

  private log(v: SchemeVersion, action: string, by: string, comment?: string) {
    this.events.push(deepFreeze({ scheme_ref: v.scheme_ref, version_no: v.version_no, action, by, at: now(), comment }));
  }

  private touch(v: SchemeVersion, userId: string) {
    v.revision += 1;
    if (!v.editors.includes(userId)) v.editors.push(userId);
  }

  // Rule 4: every field change is kept, and the log can only grow.
  private recordChange(v: SchemeVersion, field: string, oldValue: unknown, newValue: unknown, source: unknown, by: string) {
    this.changes.push(
      deepFreeze({
        scheme_ref: v.scheme_ref,
        version_no: v.version_no,
        field,
        old_value: structuredClone(oldValue),
        new_value: structuredClone(newValue),
        source: structuredClone(source),
        changed_by: by,
        changed_at: now(),
      }),
    );
  }

  // ---------- Rules 1-3: drafts, review and publishing ----------

  createScheme(userId: string, ref: string): SchemeVersion {
    const user = this.actor(userId, 'STATE_REVIEWER');
    if (!isText(ref)) throw new KbError('INVALID', 'scheme_ref is required');
    if (this.schemes.has(ref)) throw new KbError('CONFLICT', `Scheme "${ref}" already exists`);
    const v: SchemeVersion = {
      scheme_ref: ref,
      version_no: 1,
      status: 'draft',
      based_on: null,
      created_by: user.id,
      created_at: now(),
      editors: [user.id],
      revision: 0,
      fields: {},
      rules: {},
    };
    this.schemes.set(ref, [v]);
    this.log(v, 'created', user.id);
    return v;
  }

  // Rule 3: editing a live scheme starts a new draft. The published version is not touched.
  startDraft(userId: string, ref: string): SchemeVersion {
    const user = this.actor(userId, 'STATE_REVIEWER');
    const list = this.versionsOf(ref);
    const existing = this.open(ref);
    if (existing) throw new KbError('CONFLICT', `${ref} already has an open draft (v${existing.version_no}). Finish or discard it first.`);
    const live = this.live(ref);
    if (!live) throw new KbError('CONFLICT', `${ref} has nothing published to start from`);
    const v: SchemeVersion = {
      scheme_ref: ref,
      version_no: list.length + 1,
      status: 'draft',
      based_on: live.version_no,
      created_by: user.id,
      created_at: now(),
      editors: [user.id],
      revision: 0,
      fields: structuredClone(live.fields), // a copy: the published version stays frozen
      rules: { ...live.rules },
    };
    list.push(v);
    this.log(v, 'draft_started', user.id);
    return v;
  }

  setField(userId: string, ref: string, input: FieldInput): FieldRecord {
    const user = this.actor(userId, 'STATE_REVIEWER');
    const v = this.editableDraft(ref);
    const record = toRecord(ref, structuredClone(input));
    const old = v.fields[record.field];
    v.fields[record.field] = record;
    this.touch(v, user.id);
    const source = record.status === 'conflict' ? record.candidates!.map((c) => c.evidence) : record.evidence;
    this.recordChange(v, record.field, old ? valueOf(old) : null, valueOf(record), source, user.id);
    return record;
  }

  // Attach a shared rule to the draft, at the rule's latest version.
  useRule(userId: string, ref: string, code: string): SchemeVersion {
    const user = this.actor(userId, 'STATE_REVIEWER');
    const v = this.editableDraft(ref);
    const rule = this.latestRule(code);
    const old = v.rules[code] ?? null;
    if (old === rule.version_no) return v;
    v.rules[code] = rule.version_no;
    this.touch(v, user.id);
    this.recordChange(v, `rule:${code}`, old === null ? null : `v${old}`, `v${rule.version_no}`, rule.evidence, user.id);
    return v;
  }

  submit(userId: string, ref: string): SchemeVersion {
    const user = this.actor(userId, 'STATE_REVIEWER');
    const v = this.editableDraft(ref);
    if (v.fields.name?.status !== 'found') throw new KbError('INVALID', `${ref}: add the scheme name before submitting`);
    v.status = 'in_review';
    this.log(v, 'submitted', user.id);
    return v;
  }

  sendBack(userId: string, ref: string, comment: string): SchemeVersion {
    const user = this.actor(userId, 'CENTRAL_REVIEWER');
    const v = this.inReview(ref);
    if (!isText(comment)) throw new KbError('INVALID', 'Sending back needs a comment saying what to fix');
    v.status = 'draft';
    this.log(v, 'sent_back', user.id, comment);
    return v;
  }

  // Approve and publish. `revision` is the revision the Central reviewer looked at.
  publish(userId: string, ref: string, revision: number): SchemeVersion {
    const user = this.actor(userId, 'CENTRAL_REVIEWER');
    const v = this.inReview(ref);
    if (v.editors.includes(user.id)) {
      throw new KbError('FORBIDDEN', `${user.name} created or edited ${ref} v${v.version_no}, so someone else must approve it`);
    }
    if (revision !== v.revision) {
      throw new KbError('CONFLICT', `${ref} changed since you reviewed it (you saw revision ${revision}, it is now ${v.revision}). Review it again.`);
    }
    const conflicts = Object.values(v.fields).filter((f) => f.status === 'conflict').map((f) => f.field);
    if (conflicts.length) {
      throw new KbError('CONFLICT', `Sources disagree on ${conflicts.join(', ')}. Pick one value before publishing.`);
    }
    const stale = this.openFlags(ref).filter((f) => f.rule_code in v.rules && v.rules[f.rule_code] < f.to_version);
    if (stale.length) {
      const list = stale.map((f) => `${f.rule_code} (v${v.rules[f.rule_code]} -> v${f.to_version})`).join(', ');
      throw new KbError('CONFLICT', `Shared rule changed: ${list}. Update the rule in this draft, or dismiss the flag with a reason.`);
    }

    const live = this.live(ref);
    if (live) {
      live.status = 'superseded'; // kept for history, no longer served
      this.log(live, 'superseded', user.id);
    }
    v.status = 'published';
    v.published_by = user.id;
    v.published_at = now();
    // Lock the content. Only its label can change later (published -> superseded).
    deepFreeze(v.fields);
    deepFreeze(v.rules);
    Object.freeze(v.editors);
    for (const f of this.openFlags(ref)) {
      f.status = 'resolved';
      f.closed_by = user.id;
      f.closed_note = `Reviewed and published in v${v.version_no}`;
    }
    this.log(v, 'published', user.id);
    return v;
  }

  discardDraft(userId: string, ref: string): SchemeVersion {
    const user = this.actor(userId, 'STATE_REVIEWER');
    const v = this.editableDraft(ref);
    v.status = 'discarded';
    deepFreeze(v.fields);
    deepFreeze(v.rules);
    this.log(v, 'discarded', user.id);
    return v;
  }

  // ---------- Rule 5: shared eligibility rules ----------

  createRule(userId: string, code: string, input: RuleInput): RuleVersion {
    const user = this.actor(userId, 'CENTRAL_REVIEWER');
    if (this.rules.has(code)) throw new KbError('CONFLICT', `Rule "${code}" already exists`);
    const rule = this.makeRule(user.id, code, 1, input);
    this.rules.set(code, [rule]);
    return rule;
  }

  // Changing a shared rule adds a new rule version. Every scheme keeps the rule version it was
  // approved with, and each scheme that uses the rule gets a review flag.
  changeRule(userId: string, code: string, input: RuleInput): { rule: RuleVersion; flagged: string[] } {
    const user = this.actor(userId, 'CENTRAL_REVIEWER');
    this.latestRule(code); // throws if the rule does not exist
    const list = this.rules.get(code)!;
    const rule = this.makeRule(user.id, code, list.length + 1, input);
    list.push(rule);

    const flagged: string[] = [];
    for (const [ref, versions] of this.schemes) {
      const pinned = versions
        .filter((v) => (v.status === 'draft' || v.status === 'in_review' || v.status === 'published') && code in v.rules)
        .map((v) => v.rules[code]);
      if (!pinned.length) continue;
      const existing = this.openFlags(ref).find((f) => f.rule_code === code);
      if (existing) {
        existing.to_version = rule.version_no; // rule changed again before review
      } else {
        this.flags.push({
          id: this.flags.length + 1,
          scheme_ref: ref,
          rule_code: code,
          from_version: Math.min(...pinned),
          to_version: rule.version_no,
          status: 'open',
          created_at: now(),
        });
      }
      flagged.push(ref);
    }
    return { rule, flagged };
  }

  private makeRule(userId: string, code: string, version_no: number, input: RuleInput): RuleVersion {
    if (!isText(input.concept) || !isText(input.operator) || input.value === undefined || !isText(input.description)) {
      throw new KbError('INVALID', `Rule ${code} needs concept, operator, value and description`);
    }
    checkEvidence(input.evidence, `rule ${code}`);
    return deepFreeze({
      code,
      version_no,
      concept: input.concept,
      operator: input.operator,
      value: structuredClone(input.value),
      description: input.description,
      evidence: structuredClone(input.evidence),
      changed_by: userId,
      changed_at: now(),
    });
  }

  // A Central reviewer decides a flagged scheme should keep the old rule version. A reason is required.
  dismissFlag(userId: string, id: number, note: string): ReviewFlag {
    const user = this.actor(userId, 'CENTRAL_REVIEWER');
    const flag = this.flags.find((f) => f.id === id);
    if (!flag) throw new KbError('NOT_FOUND', `No flag ${id}`);
    if (flag.status !== 'open') throw new KbError('CONFLICT', `Flag ${id} is already ${flag.status}`);
    if (!isText(note)) throw new KbError('INVALID', 'Dismissing a flag needs a reason');
    flag.status = 'dismissed';
    flag.closed_by = user.id;
    flag.closed_note = note;
    return flag;
  }

  // ---------- Read API: only ever serves the published version ----------

  getPublished(ref: string) {
    const v = this.live(ref);
    if (!v) throw new KbError('NOT_FOUND', `${ref} has no published version yet`);
    return {
      scheme_ref: ref,
      version_no: v.version_no,
      published_at: v.published_at,
      published_by: v.published_by,
      fields: Object.values(v.fields),
      // each rule at the exact version this scheme version was approved with
      eligibility: Object.entries(v.rules).map(([code, no]) => this.rules.get(code)![no - 1]),
    };
  }

  listPublished() {
    return [...this.schemes.keys()].filter((ref) => this.live(ref)).map((ref) => this.getPublished(ref));
  }

  // ---------- Reviewer views ----------

  getVersion(ref: string, no: number): SchemeVersion {
    const v = this.versionsOf(ref)[no - 1];
    if (!v) throw new KbError('NOT_FOUND', `${ref} has no version ${no}`);
    return v;
  }

  history(ref: string) {
    this.versionsOf(ref);
    return {
      changes: this.changes.filter((c) => c.scheme_ref === ref),
      events: this.events.filter((e) => e.scheme_ref === ref),
    };
  }

  // Before-and-after of the open draft against the published version.
  diff(ref: string) {
    const draft = this.open(ref);
    if (!draft) throw new KbError('CONFLICT', `${ref} has no open draft to compare`);
    const live = this.live(ref);
    const before: Record<string, FieldRecord> = live ? live.fields : {};
    const names = [...new Set([...Object.keys(before), ...Object.keys(draft.fields)])];
    const fields = names
      .filter((n) => JSON.stringify(before[n]) !== JSON.stringify(draft.fields[n]))
      .map((n) => ({
        field: n,
        before: before[n] ? valueOf(before[n]) : null,
        after: draft.fields[n] ? valueOf(draft.fields[n]) : null,
        source: draft.fields[n]?.evidence ?? null,
      }));
    const liveRules: Record<string, number> = live ? live.rules : {};
    const codes = [...new Set([...Object.keys(liveRules), ...Object.keys(draft.rules)])];
    const rules = codes
      .filter((c) => liveRules[c] !== draft.rules[c])
      .map((c) => ({ rule: c, before: liveRules[c] ?? null, after: draft.rules[c] ?? null }));
    return { scheme_ref: ref, published_version: live?.version_no ?? null, draft_version: draft.version_no, fields, rules };
  }

  flagsFor(ref: string) {
    return this.flags.filter((f) => f.scheme_ref === ref);
  }

  // What Central reviewers need to look at.
  reviewQueue() {
    const in_review = [];
    for (const versions of this.schemes.values()) {
      for (const v of versions) {
        if (v.status === 'in_review') {
          in_review.push({ scheme_ref: v.scheme_ref, version_no: v.version_no, revision: v.revision, created_by: v.created_by });
        }
      }
    }
    return { in_review, open_flags: this.flags.filter((f) => f.status === 'open') };
  }
}
