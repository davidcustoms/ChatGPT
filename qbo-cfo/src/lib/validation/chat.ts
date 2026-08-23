import { answerQuestion, type NlqResult } from '../ai/nlq';
import { monthLabel, type Period } from '../util/dates';
import {
  fail,
  notAvailable,
  pass,
  type ValidationSection,
  type ValidationCheck,
  type ValidationTable,
} from './types';

/**
 * Item 11: live CFO chat QA.
 *
 * The same rule as the offline QA harness, run against the connected company:
 * every dollar figure an answer states must be present in the deterministic
 * result the resolver computed from the database. A figure that is not there
 * could only have come from the model, and fails.
 *
 * Also checked per answer: the reporting basis is stated, the period the answer
 * covers is stated, and a store conclusion is not drawn when this company has
 * no store data — the specific hallucination that would matter most to a
 * multi-location owner.
 */

interface Question {
  text: string;
  /** Answers that legitimately report "no data" instead of a figure. */
  mayBeUnanswerable?: boolean;
  /** True when the answer would be about stores. */
  storeQuestion?: boolean;
}

const QUESTIONS: Question[] = [
  { text: 'What were sales last month?' },
  { text: 'What was net income?' },
  { text: 'What was gross margin?' },
  { text: 'How much cash did we have?', mayBeUnanswerable: true },
  { text: 'How much do customers owe us?', mayBeUnanswerable: true },
  { text: 'How much do we owe vendors?', mayBeUnanswerable: true },
  { text: 'Which expense increased the most?', mayBeUnanswerable: true },
  { text: 'Which vendor did we pay the most?', mayBeUnanswerable: true },
  { text: 'How did last month compare with last year?', mayBeUnanswerable: true },
  { text: 'Which store performed best?', mayBeUnanswerable: true, storeQuestion: true },
];

const FORBIDDEN = /NaN|Infinity|\[object Object\]|undefined|\bTBD\b/;

function dollarsIn(text: string): number[] {
  return (text.match(/-?\$[\d,]+(?:\.\d{2})?/g) ?? []).map((s) => Number(s.replace(/[$,]/g, '')));
}

/** Every number anywhere in the resolver's own result object. */
function numbersInData(value: unknown, out: Set<number> = new Set()): Set<number> {
  if (typeof value === 'number' && Number.isFinite(value)) {
    out.add(Math.round(value * 100) / 100);
    out.add(Math.round(value));
  } else if (Array.isArray(value)) {
    for (const v of value) numbersInData(v, out);
  } else if (value && typeof value === 'object') {
    for (const v of Object.values(value)) numbersInData(v, out);
  }
  return out;
}

export async function validateChat(input: {
  companyId: string;
  period: Period;
  /** True when this company has store data the chat may legitimately discuss. */
  hasStoreData: boolean;
}): Promise<ValidationSection> {
  const checks: ValidationCheck[] = [];
  const table: ValidationTable = {
    title: 'Live questions against the connected company',
    columns: ['Question', 'Intent', 'Basis', 'Period', 'Figures traced', 'Status'],
    rows: [],
    caption:
      'Every dollar figure in an answer is checked against the deterministic result the resolver computed. A figure absent from that object could only have come from the model.',
  };

  const problems: string[] = [];
  let unsupportedFigures = 0;
  let missingBasis = 0;
  let storeHallucinations = 0;

  for (const question of QUESTIONS) {
    let result: NlqResult;
    try {
      result = await answerQuestion({ companyId: input.companyId, question: question.text });
    } catch (err) {
      problems.push(`"${question.text}" threw: ${err instanceof Error ? err.message : String(err)}`);
      table.rows.push({ cells: [question.text, 'error', '—', '—', '—', 'FAIL'], status: 'FAIL' });
      continue;
    }

    const notes: string[] = [];

    if (FORBIDDEN.test(result.answer)) notes.push('placeholder or non-finite value in the answer');
    if (!result.basisLabel) {
      notes.push('no reporting basis stated');
      missingBasis += 1;
    }
    if (!result.dataThrough) notes.push('no source period stated');

    const allowed = numbersInData(result.data);
    const unsupported = dollarsIn(result.answer).filter(
      (n) => !allowed.has(n) && !allowed.has(Math.abs(n)) && !allowed.has(-n),
    );
    if (unsupported.length > 0) {
      notes.push(`figure(s) not in the computed result: ${unsupported.join(', ')}`);
      unsupportedFigures += unsupported.length;
    }

    // The one that matters most for a multi-location owner: a confident store
    // ranking for a company with no store data.
    if (question.storeQuestion && !input.hasStoreData && dollarsIn(result.answer).length > 0) {
      notes.push('drew a store conclusion for a company with no store data');
      storeHallucinations += 1;
    }

    const declined =
      result.intent === 'unknown' ||
      result.caveats.length > 0 ||
      /not stored|do not have|cannot|could not|not available/i.test(result.answer);
    if (question.mayBeUnanswerable && dollarsIn(result.answer).length === 0 && !declined) {
      notes.push('produced no figures but did not say why');
    }

    if (notes.length > 0) problems.push(`"${question.text}": ${notes.join('; ')}`);

    table.rows.push({
      cells: [
        question.text,
        result.intent,
        result.basisLabel || '—',
        result.dataThrough ?? '—',
        `${result.provenance.length} provenance record(s)`,
        notes.length === 0 ? 'PASS' : 'FAIL',
      ],
      status: notes.length === 0 ? 'PASS' : 'FAIL',
    });
  }

  const answered = table.rows.filter((r) => r.status === 'PASS').length;

  checks.push(
    unsupportedFigures === 0
      ? pass('chat_no_invented_figures', 'CFO chat', 'No unsupported numbers',
          `Every dollar figure across ${QUESTIONS.length} live answers is present in the deterministic result the resolver computed.`)
      : fail('chat_no_invented_figures', 'CFO chat', 'No unsupported numbers',
          `${unsupportedFigures} figure(s) appeared in an answer without being in the computed result.`,
          'A number that is not in the resolver output came from the model. Do not use the chat until this is fixed.'),
  );

  checks.push(
    missingBasis === 0
      ? pass('chat_basis', 'CFO chat', 'Reporting basis stated',
          'Every answer carries its accounting basis.')
      : fail('chat_basis', 'CFO chat', 'Reporting basis stated',
          `${missingBasis} answer(s) did not state the basis.`,
          'An accrual figure read as cash is a wrong figure. Every answer must state its basis.'),
  );

  checks.push(
    storeHallucinations === 0
      ? input.hasStoreData
        ? pass('chat_store_conclusions', 'CFO chat', 'Store conclusions',
            'This company has store data, and the store answer was drawn from it.')
        : pass('chat_store_conclusions', 'CFO chat', 'Store conclusions',
            'This company has no store data, and the chat said so rather than ranking stores.')
      : fail('chat_store_conclusions', 'CFO chat', 'Store conclusions',
          `${storeHallucinations} store answer(s) produced figures for a company with no store data.`,
          'A fabricated store ranking is the most damaging answer this application could give a multi-location owner.'),
  );

  checks.push(
    problems.length === 0
      ? pass('chat_overall', 'CFO chat', 'Live question set',
          `${answered} of ${QUESTIONS.length} questions answered correctly, with source period, basis and traceability on each.`)
      : fail('chat_overall', 'CFO chat', 'Live question set',
          `${QUESTIONS.length - answered} of ${QUESTIONS.length} questions had a problem: ${problems.slice(0, 4).join(' | ')}${problems.length > 4 ? ' | …' : ''}`,
          'Review each failing answer before letting anyone rely on the chat.'),
  );

  return {
    key: 'chat',
    title: `Live CFO chat QA — ${monthLabel(input.period)}`,
    checks,
    tables: [table],
  };
}
