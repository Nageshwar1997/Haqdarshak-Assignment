// Synthetic users, shared rules and schemes. All names, amounts and sources are made up.
import { KnowledgeBase } from './store.ts';
import type { Evidence, FieldInput } from './store.ts';

export const ev = (text: string, location: string, source_ref: string, captured_at = '2026-10-01'): Evidence => ({
  text,
  location,
  source_ref,
  captured_at,
});

const found = (field: string, value: unknown, evidence: Evidence, confidence = 0.9): FieldInput => ({
  field,
  value,
  evidence,
  confidence,
  status: 'found',
});

const notFound = (field: string, note: string): FieldInput => ({
  field,
  value: null,
  evidence: null,
  confidence: null,
  status: 'not_found',
  note,
});

export function seed(): KnowledgeBase {
  const kb = new KnowledgeBase();

  kb.addUser({ id: 'asha', name: 'Asha (State reviewer, MH)', roles: ['STATE_REVIEWER'] });
  kb.addUser({ id: 'ravi', name: 'Ravi (State reviewer, KA)', roles: ['STATE_REVIEWER'] });
  kb.addUser({ id: 'meera', name: 'Meera (Central reviewer)', roles: ['CENTRAL_REVIEWER'] });
  kb.addUser({ id: 'vikram', name: 'Vikram (Central reviewer)', roles: ['CENTRAL_REVIEWER'] });
  kb.addUser({ id: 'neha', name: 'Neha (State + Central reviewer)', roles: ['STATE_REVIEWER', 'CENTRAL_REVIEWER'] });

  // Shared eligibility rules (one condition each: concept, operator, value)
  const register = 'synthetic: shared eligibility criteria register, 2026';
  kb.createRule('meera', 'INCOME_BELOW_2_5L', {
    concept: 'annual_family_income',
    operator: '<',
    value: 250000,
    description: 'Annual family income below ₹2.5 lakh',
    evidence: ev('annual family income below Rs. 2,50,000', 'Section 3', register),
  });
  kb.createRule('meera', 'SC_ST', {
    concept: 'social_category',
    operator: 'in',
    value: ['SC', 'ST'],
    description: 'Belongs to a Scheduled Caste or Scheduled Tribe',
    evidence: ev('applicant should belong to SC/ST community', 'Section 4', register),
  });
  kb.createRule('meera', 'RESIDENT_MH', {
    concept: 'state_of_residence',
    operator: '=',
    value: 'MH',
    description: 'Resident of Maharashtra',
    evidence: ev('domicile of Maharashtra', 'Section 5', register),
  });
  kb.createRule('meera', 'AGE_60_PLUS', {
    concept: 'age',
    operator: '>=',
    value: 60,
    description: 'Aged 60 or above',
    evidence: ev('aged 60 years and above', 'Section 6', register),
  });
  kb.createRule('meera', 'SMALL_FARMER', {
    concept: 'land_holding_hectares',
    operator: '<=',
    value: 2,
    description: 'Owns up to 2 hectares of farm land',
    evidence: ev('landholding up to 2 hectares', 'Section 7', register),
  });

  // Create, fill, submit and approve a scheme through the normal workflow.
  const add = (ref: string, author: string, approver: string, fields: FieldInput[], rules: string[]) => {
    kb.createScheme(author, ref);
    for (const f of fields) kb.setField(author, ref, f);
    for (const r of rules) kb.useRule(author, ref, r);
    const { revision } = kb.submit(author, ref);
    kb.publish(approver, ref, revision);
  };

  const cen = 'synthetic: Farmer Income Support guidelines 2025 (PDF)';
  const cenText = 'Rs. 6,000 per year in three equal instalments';
  add(
    'SYN-CEN-001',
    'asha',
    'meera',
    [
      found('name', 'Farmer Income Support (synthetic)', ev('Farmer Income Support Scheme', 'Cover page', cen)),
      found('benefit_amount', 6000, ev(cenText, 'Section 2.1', cen), 0.95),
      found('benefit_frequency', 'yearly', ev(cenText, 'Section 2.1', cen), 0.95),
      found('instalments', 3, ev(cenText, 'Section 2.1', cen), 0.95),
      notFound('deadline', 'Guidelines say enrolment is open all year; no deadline is stated'),
    ],
    ['SMALL_FARMER'],
  );

  const mh = 'synthetic: Maharashtra WCD Government Resolution 2025-06 (PDF)';
  add(
    'SYN-MH-002',
    'asha',
    'meera',
    [
      found('name', 'Girl Child Education Grant, Maharashtra (synthetic)', ev('Girl Child Education Grant', 'Title', mh)),
      found('benefit_amount', 25000, ev('one-time grant of Rs. 25,000', 'Para 2', mh)),
      found('benefit_frequency', 'one_time', ev('one-time grant of Rs. 25,000', 'Para 2', mh)),
      found('deadline', '2026-12-31', ev('applications by 31 December 2026', 'Para 5', mh), 0.85),
      found(
        'required_documents',
        ['Aadhaar of the girl', 'Family income certificate', 'School bonafide certificate'],
        ev('Aadhaar, income certificate and bonafide certificate from school', 'Annexure A', mh),
      ),
    ],
    ['INCOME_BELOW_2_5L', 'RESIDENT_MH'],
  );

  const ka = 'synthetic: Karnataka Social Welfare scholarship portal, scheme page';
  add(
    'SYN-KA-003',
    'ravi',
    'vikram',
    [
      found('name', 'Post-Matric Scholarship for SC/ST Students, Karnataka (synthetic)', ev('Post-Matric Scholarship', 'Page title', ka)),
      found('benefit_amount', 12000, ev('Rs. 12,000 per academic year', 'Benefits tab', ka)),
      found('benefit_frequency', 'yearly', ev('Rs. 12,000 per academic year', 'Benefits tab', ka)),
      found('deadline', '2026-11-30', ev('Last date: 30-11-2026', 'Banner on page', ka), 0.7),
    ],
    ['INCOME_BELOW_2_5L', 'SC_ST'],
  );

  const kaPension = 'synthetic: Karnataka Old Age Pension G.O. 2024 (PDF)';
  add(
    'SYN-KA-004',
    'ravi',
    'meera',
    [
      found('name', 'Old Age Pension, Karnataka (synthetic)', ev('Old Age Pension Scheme', 'Title', kaPension)),
      found('benefit_amount', 1200, ev('Rs. 1,200 per month', 'Para 3', kaPension)),
      found('benefit_frequency', 'monthly', ev('Rs. 1,200 per month', 'Para 3', kaPension)),
      notFound('deadline', 'Pension applications are accepted all year; the G.O. gives no last date'),
    ],
    ['INCOME_BELOW_2_5L', 'AGE_60_PLUS'],
  );

  return kb;
}
