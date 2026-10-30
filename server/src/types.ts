// Shapes that the API sends and receives (the API contract shared with the React client).

export type Role = 'STATE_REVIEWER' | 'CENTRAL_REVIEWER';
export type User = { id: string; name: string; roles: Role[] };

export type Evidence = {
  text: string; // exact text the value came from
  location: string; // page or section in the source
  source_ref: string; // link, or a placeholder name for a synthetic source
  captured_at: string; // date it was captured (YYYY-MM-DD)
};

export type FieldStatus = 'found' | 'not_found' | 'conflict';
export type Candidate = { value: unknown; evidence: Evidence };

// One scheme field, in the format the brief asks for.
export type FieldRecord = {
  scheme_ref: string;
  field: string;
  value: unknown; // null when not found or in conflict
  evidence: Evidence | null;
  confidence: number | null; // 0 to 1
  status: FieldStatus;
  note: string | null;
  candidates: Candidate[] | null; // conflict only: every value with its source
};

// What a State reviewer sends to set one field (checked by toRecord in service.ts).
export type FieldInput = {
  field: string;
  value?: unknown;
  evidence?: Evidence | null;
  confidence?: number | null;
  status: FieldStatus;
  note?: string | null;
  candidates?: Candidate[] | null;
};

export type VersionStatus = 'draft' | 'in_review' | 'published' | 'superseded' | 'discarded';

export type SchemeVersion = {
  scheme_ref: string;
  version_no: number;
  status: VersionStatus;
  based_on: number | null; // the published version this draft was copied from
  created_by: string;
  created_at: string;
  editors: string[]; // everyone who changed something in this version (the creator too)
  revision: number; // goes up on every edit, so an approval is tied to what the reviewer saw
  fields: Record<string, FieldRecord>;
  rules: Record<string, number>; // shared rule code -> the rule version this scheme version uses
  published_by: string | null;
  published_at: string | null;
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

export type WorkflowAction = 'created' | 'draft_started' | 'submitted' | 'sent_back' | 'published' | 'superseded' | 'discarded';

export type WorkflowEvent = {
  scheme_ref: string;
  version_no: number;
  action: WorkflowAction;
  by: string;
  at: string;
  comment: string | null;
};

export type FlagStatus = 'open' | 'resolved' | 'dismissed';

export type ReviewFlag = {
  id: number;
  scheme_ref: string;
  rule_code: string;
  from_version: number;
  to_version: number;
  status: FlagStatus;
  created_at: string;
  closed_by: string | null;
  closed_note: string | null;
};

export type PublishedScheme = {
  scheme_ref: string;
  version_no: number;
  published_at: string;
  published_by: string;
  fields: FieldRecord[];
  eligibility: RuleVersion[]; // each rule at the version pinned by this scheme version
};

export type SchemeSummary = {
  scheme_ref: string;
  name: string | null;
  published_version: number | null;
  open_version: { version_no: number; status: 'draft' | 'in_review'; revision: number; created_by: string } | null;
  open_flags: number;
};

export type Diff = {
  scheme_ref: string;
  published_version: number | null;
  draft_version: number;
  fields: { field: string; before: unknown; after: unknown; source: Evidence | null }[];
  rules: { rule: string; before: number | null; after: number | null }[];
};

export type ReviewQueue = {
  in_review: { scheme_ref: string; version_no: number; revision: number; created_by: string }[];
  open_flags: ReviewFlag[];
};

export type RuleSummary = { code: string; versions: RuleVersion[] };

export type FieldType = 'text' | 'number' | 'integer' | 'enum' | 'date' | 'text_list';
export type FieldMeta = { name: string; type: FieldType; options?: string[]; label: string };
