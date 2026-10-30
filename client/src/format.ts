// Turning stored values into text people can read.
import type { Evidence, FieldMeta, FieldType, RuleVersion } from './types.ts';

// Today's date as YYYY-MM-DD in the browser's time zone.
export function today(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// ISO timestamp -> "30 Oct 2026, 2:15 pm"
export function formatWhen(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
}

export function isEmpty(value: unknown): boolean {
  return value === null || value === undefined || (Array.isArray(value) && value.length === 0);
}

// One value as text. Amounts get a rupee sign; lists are joined.
export function formatValue(value: unknown, field?: string): string {
  if (isEmpty(value)) return '—';
  if (field === 'benefit_amount' && typeof value === 'number') return `₹${value.toLocaleString('en-IN')}`;
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return value.map((v) => formatValue(v, field)).join('; ');
  return JSON.stringify(value);
}

// "concept operator value", e.g. "annual_family_income < 250000"
export function ruleCondition(rule: RuleVersion): string {
  const value = typeof rule.value === 'string' ? rule.value : JSON.stringify(rule.value);
  return `${rule.concept} ${rule.operator} ${value}`;
}

// "CODE vN: description (concept operator value)"
export function ruleLine(rule: RuleVersion): string {
  return `${rule.code} v${rule.version_no}: ${rule.description} (${ruleCondition(rule)})`;
}

// FieldChange.source can be one Evidence, a list of them (conflict) or null.
export function sourceRefs(source: unknown): string {
  const list = Array.isArray(source) ? source : source ? [source] : [];
  const refs = list
    .map((s) => (s && typeof s === 'object' && 'source_ref' in s ? String((s as Evidence).source_ref) : ''))
    .filter(Boolean);
  return refs.length ? [...new Set(refs)].join('; ') : '—';
}

// ---------- Form values: inputs hold strings, the API wants typed values ----------

export function typeOf(fields: FieldMeta[], name: string): FieldType {
  return fields.find((f) => f.name === name)?.type ?? 'text';
}

// Stored value -> text for an input.
export function toInputText(value: unknown, type: FieldType): string {
  if (isEmpty(value)) return '';
  if (type === 'text_list' && Array.isArray(value)) return value.join('\n');
  return typeof value === 'string' ? value : String(value);
}

// Input text -> typed value. Anything that does not parse is sent as typed, so the server can say what is wrong.
export function fromInputText(text: string, type: FieldType): unknown {
  if (type === 'text_list') {
    return text
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);
  }
  if (type === 'number' || type === 'integer') {
    if (text.trim() === '') return null;
    const n = Number(text);
    return Number.isFinite(n) ? n : text;
  }
  return text;
}
