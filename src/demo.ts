// Walks through every rule in the S1 brief with synthetic data and checks each one.
// Run: npm run demo   (exits with code 1 if any check fails)
import { seed, ev } from './seed.ts';
import { KbError } from './store.ts';

const kb = seed();
let passed = 0;
let failed = 0;

function check(label: string, ok: boolean) {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (ok) passed++;
  else failed++;
}

// The action must be refused with this error code.
function refused(label: string, code: string, action: () => unknown) {
  try {
    action();
    check(`${label} (but it was allowed!)`, false);
  } catch (err) {
    check(label, err instanceof KbError && err.code === code);
    console.log(`        -> ${err instanceof Error ? err.message : String(err)}`);
  }
}

const section = (title: string) => console.log(`\n${title}\n${'-'.repeat(title.length)}`);
const amountOf = (ref: string) => kb.getPublished(ref).fields.find((f) => f.field === 'benefit_amount')?.value;
const incomeLimit = (ref: string) => kb.getPublished(ref).eligibility.find((r) => r.code === 'INCOME_BELOW_2_5L')?.value;

console.log(`Loaded ${kb.listPublished().length} published synthetic schemes.`);

// ---------------------------------------------------------------------------
section('Rule 1: two roles, and nobody approves their own draft');
const up = 'SYN-UP-005';
const upPortal = 'synthetic: UP social welfare portal, scheme page';
const upGO = 'synthetic: UP Government Order 2026-04 (PDF)';

refused('A Central reviewer cannot create a draft', 'FORBIDDEN', () => kb.createScheme('meera', up));
kb.createScheme('neha', up);
kb.setField('neha', up, {
  field: 'name',
  value: 'Widow Pension, Uttar Pradesh (synthetic)',
  evidence: ev('Widow Pension Scheme', 'Page title', upPortal),
  confidence: 0.9,
  status: 'found',
});
kb.setField('neha', up, {
  field: 'benefit_amount',
  value: 1000,
  evidence: ev('Rs. 1,000 per month', 'Benefits section', upPortal),
  confidence: 0.8,
  status: 'found',
});
refused('A Central reviewer cannot edit a draft', 'FORBIDDEN', () =>
  kb.setField('meera', up, { field: 'benefit_amount', value: 1, evidence: ev('x', 'x', 'x'), confidence: 1, status: 'found' }),
);
let rev = kb.submit('neha', up).revision;
refused('A State reviewer cannot publish', 'FORBIDDEN', () => kb.publish('asha', up, rev));
refused('Neha has both roles but drafted this, so she cannot approve it', 'FORBIDDEN', () => kb.publish('neha', up, rev));

// ---------------------------------------------------------------------------
section('Rule 2: draft -> in review -> published, or sent back with a comment');
check('After submit the scheme is "in review"', kb.getVersion(up, 1).status === 'in_review');
refused('Nobody can edit a draft while it is in review', 'CONFLICT', () =>
  kb.setField('neha', up, { field: 'benefit_amount', value: 1500, evidence: ev('x', 'x', 'x'), confidence: 1, status: 'found' }),
);
refused('Sending back needs a comment', 'INVALID', () => kb.sendBack('vikram', up, ''));
kb.sendBack('vikram', up, 'The state G.O. may have a newer amount. Please check.');
check(
  'Sent back: it is a draft again and the comment is logged',
  kb.getVersion(up, 1).status === 'draft' && kb.history(up).events.some((e) => e.action === 'sent_back' && !!e.comment),
);

// Two sources disagree: keep both values with their sources.
kb.setField('neha', up, {
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
rev = kb.submit('neha', up).revision;
refused('A field where sources disagree blocks publishing', 'CONFLICT', () => kb.publish('vikram', up, rev));
const revVikramSaw = rev;
kb.sendBack('vikram', up, 'Use the value from the newer Government Order.');
kb.setField('neha', up, {
  field: 'benefit_amount',
  value: 1500,
  evidence: ev('pension revised to Rs. 1,500 per month', 'Para 4', upGO),
  confidence: 0.85,
  status: 'found',
  note: 'The April 2026 G.O. is newer than the portal page',
});
rev = kb.submit('neha', up).revision;
refused('Approving an old revision is refused (the draft changed after it was reviewed)', 'CONFLICT', () =>
  kb.publish('vikram', up, revVikramSaw),
);
kb.publish('vikram', up, rev);
check('Vikram (a different person) publishes it; the read API serves ₹1,500', kb.getPublished(up).version_no === 1 && amountOf(up) === 1500);

// ---------------------------------------------------------------------------
section('Rule 3: publishing locks a version; edits go into a new draft');
const mh = 'SYN-MH-002';
const mhGR = 'synthetic: Maharashtra WCD Government Resolution 2026-09 (PDF)';
const draft = kb.startDraft('asha', mh);
kb.setField('asha', mh, {
  field: 'benefit_amount',
  value: 30000,
  evidence: ev('grant enhanced to Rs. 30,000', 'Para 2', mhGR),
  confidence: 0.9,
  status: 'found',
});
kb.setField('asha', mh, {
  field: 'deadline',
  value: '2027-01-31',
  evidence: ev('last date extended to 31 January 2027', 'Para 5', mhGR),
  confidence: 0.9,
  status: 'found',
});
check(
  `While v${draft.version_no} is a draft, the read API still serves v1 with ₹25,000`,
  kb.getPublished(mh).version_no === 1 && amountOf(mh) === 25000,
);
refused('Only one open draft per scheme', 'CONFLICT', () => kb.startDraft('ravi', mh));
let lockHeld = false;
try {
  kb.getVersion(mh, 1).fields.benefit_amount.value = 99999;
} catch {
  lockHeld = true;
}
check('Changing published v1 directly in code throws an error (it is frozen)', lockHeld && amountOf(mh) === 25000);

console.log('  What the Central reviewer sees before approving:');
for (const d of kb.diff(mh).fields) {
  console.log(`        ${d.field}: ${JSON.stringify(d.before)} -> ${JSON.stringify(d.after)}  (source: ${d.source?.source_ref})`);
}
rev = kb.submit('asha', mh).revision;
kb.publish('meera', mh, rev);
check('After approval the read API serves v2 with ₹30,000', kb.getPublished(mh).version_no === 2 && amountOf(mh) === 30000);
check(
  'v1 is kept, marked superseded, and still says ₹25,000',
  kb.getVersion(mh, 1).status === 'superseded' && kb.getVersion(mh, 1).fields.benefit_amount.value === 25000,
);

// ---------------------------------------------------------------------------
section('Rule 4: every field change is recorded (who, when, old, new, source)');
const change = kb.history(mh).changes.find((c) => c.field === 'benefit_amount' && c.version_no === 2)!;
console.log(`        ${change.changed_by} changed ${change.field} at ${change.changed_at}: ${change.old_value} -> ${change.new_value}`);
console.log(`        source: ${JSON.stringify(change.source)}`);
check(
  'The change shows asha, ₹25,000 -> ₹30,000 and the 2026-09 G.R. as source',
  change.changed_by === 'asha' && change.old_value === 25000 && change.new_value === 30000 && JSON.stringify(change.source).includes('2026-09'),
);
const actions = kb.history(mh).events.map((e) => `v${e.version_no}:${e.action}`);
console.log(`        workflow events: ${actions.join(', ')}`);
check('Workflow steps are logged too', actions.includes('v1:superseded') && actions.includes('v2:published'));
let logLocked = false;
try {
  change.new_value = 1;
} catch {
  logLocked = true;
}
check('A history entry cannot be edited afterwards', logLocked);

// ---------------------------------------------------------------------------
section('Principle: every fact points back to its source');
const scratch = 'SYN-MH-006';
kb.createScheme('asha', scratch);
refused('A value without evidence is refused', 'INVALID', () =>
  kb.setField('asha', scratch, { field: 'benefit_amount', value: 5000, evidence: null, confidence: 0.9, status: 'found' }),
);
refused('"Not found" needs a reason', 'INVALID', () =>
  kb.setField('asha', scratch, { field: 'deadline', value: null, evidence: null, confidence: null, status: 'not_found' }),
);
refused('A conflict must keep every value with its source', 'INVALID', () =>
  kb.setField('asha', scratch, {
    field: 'benefit_amount',
    value: null,
    evidence: null,
    confidence: null,
    status: 'conflict',
    candidates: [{ value: 5000, evidence: ev('Rs. 5,000', 'Para 1', 'synthetic: notice') }],
  }),
);
kb.discardDraft('asha', scratch);

// ---------------------------------------------------------------------------
section('Rule 5: changing a shared rule flags every scheme that uses it');
const { flagged } = kb.changeRule('meera', 'INCOME_BELOW_2_5L', {
  concept: 'annual_family_income',
  operator: '<',
  value: 300000,
  description: 'Annual family income below ₹3 lakh',
  evidence: ev('income limit revised to Rs. 3,00,000', 'Para 1', 'synthetic: Social Justice Dept circular 2026-10'),
});
console.log(`        flagged for review: ${flagged.join(', ')}`);
check('All 3 schemes using the income rule are flagged; the farmer scheme is not', flagged.length === 3 && !flagged.includes('SYN-CEN-001'));

const ka = 'SYN-KA-003';
check('No silent change: SYN-KA-003 still serves the ₹2.5 lakh limit', incomeLimit(ka) === 250000);
kb.startDraft('ravi', ka);
rev = kb.submit('ravi', ka).revision;
refused('Publishing a draft that still uses the old rule version is blocked', 'CONFLICT', () => kb.publish('vikram', ka, rev));
kb.sendBack('vikram', ka, 'Adopt the revised income limit.');
kb.useRule('ravi', ka, 'INCOME_BELOW_2_5L');
console.log(`        diff: ${JSON.stringify(kb.diff(ka).rules)}`);
rev = kb.submit('ravi', ka).revision;
kb.publish('vikram', ka, rev);
check(
  'After review and approval SYN-KA-003 serves ₹3 lakh and its flag is resolved',
  incomeLimit(ka) === 300000 && kb.flagsFor(ka).every((f) => f.status === 'resolved'),
);

const pensionFlag = kb.flagsFor('SYN-KA-004')[0];
refused('Dismissing a flag needs a reason', 'INVALID', () => kb.dismissFlag('meera', pensionFlag.id, ''));
kb.dismissFlag('meera', pensionFlag.id, 'Pension G.O. keeps its own ₹2.5 lakh limit; split into a separate rule later.');
check(
  'SYN-KA-004: flag dismissed with a reason, and it keeps the old rule version',
  kb.flagsFor('SYN-KA-004')[0].status === 'dismissed' && incomeLimit('SYN-KA-004') === 250000,
);
check('SYN-MH-002 is still waiting in the review queue', kb.reviewQueue().open_flags.some((f) => f.scheme_ref === mh));

// ---------------------------------------------------------------------------
console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exitCode = 1;
