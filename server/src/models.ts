// MongoDB collections (Mongoose models), their indexes, and the guards that protect published data and history.
import mongoose, { Schema } from 'mongoose';
import type { Query } from 'mongoose';
import type { FieldChange, ReviewFlag, RuleVersion, SchemeVersion, User, VersionStatus, WorkflowEvent } from './types.ts';

// Thrown when code tries a write that the data layer never allows. It means a bug in our code, so the API answers 500.
export class GuardError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GuardError';
  }
}

// Projection for every read we send out: never leak Mongo's internal _id (and __v, if an old document has one).
export const HIDDEN = { _id: 0, __v: 0 } as const;

// Shared schema options:
// - versionKey: false: do not add the __v field
// - minimize: false: keep empty objects such as fields: {} (Mongoose drops them by default)
// - toJSON: if a full document is ever turned into JSON, leave out _id
const options = {
  versionKey: false as const,
  minimize: false,
  toJSON: {
    transform: (_doc: unknown, ret: Record<string, unknown>) => {
      delete ret._id;
      return ret;
    },
  },
};

// Note on ordering: lists are sorted by _id. ObjectIds grow in the order documents are inserted (within one server).

// ---------- guards ----------

// Every kind of query that changes or deletes existing documents.
const CHANGE_OPS = ['updateOne', 'updateMany', 'findOneAndUpdate', 'replaceOne', 'findOneAndReplace'] as const;
const DELETE_OPS = ['deleteOne', 'deleteMany', 'findOneAndDelete'] as const;

// Append-only collections (history and rule versions): once written, an entry is never changed or deleted.
// Mongoose runs these hooks before the query, so the write never reaches MongoDB.
function appendOnly(schema: Schema, name: string) {
  const refuse = () => {
    throw new GuardError(`${name} is append-only: entries cannot be changed or deleted`);
  };
  schema.pre([...CHANGE_OPS, ...DELETE_OPS], refuse); // Model.updateOne(...), Model.deleteMany(...) and so on
  schema.pre(['updateOne', 'deleteOne'], { document: true, query: false }, refuse); // doc.updateOne(), doc.deleteOne()
  schema.pre('save', function () {
    if (!this.isNew) refuse(); // doc.save() on an entry that already exists
  });
}

// Which parts of a scheme version an update may change, depending on its current status.
// Everything else (scheme_ref, version_no, created_by, ...) never changes after the version is created.
const CHANGEABLE: Record<VersionStatus, string[]> = {
  draft: ['status', 'fields', 'rules', 'editors', 'revision'], // only a draft's content can be edited
  in_review: ['status', 'published_by', 'published_at'], // send back, or publish
  published: ['status'], // only to mark it superseded; its content is locked
  superseded: [], // final, kept for history
  discarded: [], // final, kept for history
};

// Allowed status moves (see the diagram in the README).
const NEXT_STATUS: Record<VersionStatus, VersionStatus[]> = {
  draft: ['in_review', 'discarded'],
  in_review: ['draft', 'published'],
  published: ['superseded'],
  superseded: [],
  discarded: [],
};

// Top-level paths an update touches, e.g. { $set: { 'fields.name': x }, $inc: { revision: 1 } } -> ['fields', 'revision'].
function touchedPaths(update: Record<string, unknown>): string[] {
  const paths: string[] = [];
  for (const [key, value] of Object.entries(update)) {
    if (key.startsWith('$') && value && typeof value === 'object') paths.push(...Object.keys(value));
    else paths.push(key); // a plain { status: 'x' } means $set
  }
  return paths.map((p) => p.split('.')[0]);
}

// scheme_versions guard. Every update must say in its filter which status it expects the version to be in,
// for example { scheme_ref, version_no, status: 'draft' }. That makes each change conditional (it does nothing
// if someone else moved the version on), and lets this hook check the change is allowed for that status.
function guardVersionUpdate(this: Query<unknown, unknown>) {
  const status = this.getFilter().status as VersionStatus | undefined;
  if (typeof status !== 'string' || !(status in CHANGEABLE)) {
    throw new GuardError('scheme_versions: an update must pin the status it expects in its filter, e.g. { status: "draft" }');
  }
  if (CHANGEABLE[status].length === 0) throw new GuardError(`scheme_versions: a ${status} version is final and cannot be changed`);
  if (this.getOptions().upsert) throw new GuardError('scheme_versions: upserts are not allowed; create versions with create()');

  const update = this.getUpdate();
  if (!update || Array.isArray(update)) throw new GuardError('scheme_versions: pipeline updates are not allowed');
  const blocked = touchedPaths(update).filter((p) => !CHANGEABLE[status].includes(p));
  if (blocked.length) throw new GuardError(`scheme_versions: a ${status} version cannot change ${blocked.join(', ')}`);

  const set = (update.$set ?? update) as { status?: VersionStatus };
  if (set.status !== undefined && !NEXT_STATUS[status].includes(set.status)) {
    throw new GuardError(`scheme_versions: status cannot go from ${status} to ${set.status}`);
  }
}

// ---------- schemas ----------

const userSchema = new Schema<User>(
  {
    id: { type: String, required: true },
    name: { type: String, required: true },
    roles: [{ type: String, enum: ['STATE_REVIEWER', 'CENTRAL_REVIEWER'] }],
  },
  { ...options, id: false }, // id: false stops Mongoose adding its own "id" alias for _id
);
userSchema.index({ id: 1 }, { unique: true, name: 'user_id_unique' });

// One row per scheme: its ref is unique, and it gives the order schemes were created in.
const schemeSchema = new Schema({ scheme_ref: { type: String, required: true }, created_at: { type: String, required: true } }, options);
schemeSchema.index({ scheme_ref: 1 }, { unique: true, name: 'scheme_ref_unique' });

const schemeVersionSchema = new Schema<SchemeVersion>(
  {
    scheme_ref: { type: String, required: true },
    version_no: { type: Number, required: true },
    status: { type: String, enum: Object.keys(CHANGEABLE), required: true },
    based_on: { type: Number, default: null },
    created_by: { type: String, required: true },
    created_at: { type: String, required: true },
    editors: { type: [String], default: [] },
    revision: { type: Number, default: 0 },
    fields: { type: Schema.Types.Mixed, default: () => ({}) }, // field name -> FieldRecord
    rules: { type: Schema.Types.Mixed, default: () => ({}) }, // rule code -> pinned rule version
    published_by: { type: String, default: null },
    published_at: { type: String, default: null },
  },
  options,
);
schemeVersionSchema.index({ scheme_ref: 1, version_no: 1 }, { unique: true, name: 'version_no_unique' });
// At most one published version per scheme (MongoDB enforces this even if two requests race).
schemeVersionSchema.index(
  { scheme_ref: 1 },
  { unique: true, name: 'one_published_per_scheme', partialFilterExpression: { status: 'published' } },
);
// At most one open version (draft or in review) per scheme.
schemeVersionSchema.index(
  { scheme_ref: 1 },
  { unique: true, name: 'one_open_version_per_scheme', partialFilterExpression: { status: { $in: ['draft', 'in_review'] } } },
);
schemeVersionSchema.index({ status: 1 });
schemeVersionSchema.pre(['updateOne', 'updateMany', 'findOneAndUpdate'], guardVersionUpdate);
schemeVersionSchema.pre(['replaceOne', 'findOneAndReplace', ...DELETE_OPS], () => {
  throw new GuardError('scheme_versions: versions are never replaced or deleted');
});
schemeVersionSchema.pre('save', function () {
  // doc.save() would skip the update guard above, so existing versions may only change through updateOne().
  if (!this.isNew) throw new GuardError('scheme_versions: change a version with a conditional updateOne(), not save()');
});

// The evidence object used by rule versions (no _id of its own).
const evidenceSchema = new Schema(
  {
    text: { type: String, required: true },
    location: { type: String, required: true },
    source_ref: { type: String, required: true },
    captured_at: { type: String, required: true },
  },
  { _id: false },
);

const ruleVersionSchema = new Schema<RuleVersion>(
  {
    code: { type: String, required: true },
    version_no: { type: Number, required: true },
    concept: { type: String, required: true },
    operator: { type: String, required: true },
    value: { type: Schema.Types.Mixed },
    description: { type: String, required: true },
    evidence: { type: evidenceSchema, required: true },
    changed_by: { type: String, required: true },
    changed_at: { type: String, required: true },
  },
  options,
);
ruleVersionSchema.index({ code: 1, version_no: 1 }, { unique: true, name: 'rule_version_unique' });
appendOnly(ruleVersionSchema, 'rule_versions'); // a rule change adds a new version; old versions stay as they were

const fieldChangeSchema = new Schema<FieldChange>(
  {
    scheme_ref: { type: String, required: true },
    version_no: { type: Number, required: true },
    field: { type: String, required: true },
    old_value: { type: Schema.Types.Mixed },
    new_value: { type: Schema.Types.Mixed },
    source: { type: Schema.Types.Mixed },
    changed_by: { type: String, required: true },
    changed_at: { type: String, required: true },
  },
  options,
);
fieldChangeSchema.index({ scheme_ref: 1 });
appendOnly(fieldChangeSchema, 'field_changes'); // the change log can only grow

const workflowEventSchema = new Schema<WorkflowEvent>(
  {
    scheme_ref: { type: String, required: true },
    version_no: { type: Number, required: true },
    action: { type: String, required: true },
    by: { type: String, required: true },
    at: { type: String, required: true },
    comment: { type: String, default: null },
  },
  options,
);
workflowEventSchema.index({ scheme_ref: 1 });
appendOnly(workflowEventSchema, 'workflow_events'); // the workflow log can only grow

const reviewFlagSchema = new Schema<ReviewFlag>(
  {
    id: { type: Number, required: true },
    scheme_ref: { type: String, required: true },
    rule_code: { type: String, required: true },
    from_version: { type: Number, required: true },
    to_version: { type: Number, required: true },
    status: { type: String, enum: ['open', 'resolved', 'dismissed'], required: true },
    created_at: { type: String, required: true },
    closed_by: { type: String, default: null },
    closed_note: { type: String, default: null },
  },
  { ...options, id: false },
);
reviewFlagSchema.index({ id: 1 }, { unique: true, name: 'flag_id_unique' });
// At most one open flag per scheme and rule (a second rule change updates the open flag instead).
reviewFlagSchema.index(
  { scheme_ref: 1, rule_code: 1 },
  { unique: true, name: 'one_open_flag_per_rule', partialFilterExpression: { status: 'open' } },
);

// Number sequences (MongoDB has no auto-increment). _id is the sequence name, e.g. "review_flags".
const counterSchema = new Schema({ _id: { type: String, required: true }, seq: { type: Number, default: 0 } }, { versionKey: false });

export const UserModel = mongoose.model('User', userSchema, 'users');
export const SchemeModel = mongoose.model('Scheme', schemeSchema, 'schemes');
export const SchemeVersionModel = mongoose.model('SchemeVersion', schemeVersionSchema, 'scheme_versions');
export const RuleVersionModel = mongoose.model('RuleVersion', ruleVersionSchema, 'rule_versions');
export const FieldChangeModel = mongoose.model('FieldChange', fieldChangeSchema, 'field_changes');
export const WorkflowEventModel = mongoose.model('WorkflowEvent', workflowEventSchema, 'workflow_events');
export const ReviewFlagModel = mongoose.model('ReviewFlag', reviewFlagSchema, 'review_flags');
export const CounterModel = mongoose.model('Counter', counterSchema, 'counters');

export const ALL_MODELS = [
  UserModel,
  SchemeModel,
  SchemeVersionModel,
  RuleVersionModel,
  FieldChangeModel,
  WorkflowEventModel,
  ReviewFlagModel,
  CounterModel,
];
