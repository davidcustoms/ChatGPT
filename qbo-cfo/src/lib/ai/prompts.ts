/**
 * System prompts and guardrails for the AI CFO layer.
 *
 * The guardrails are not advisory: the application computes every number, the
 * schema requires the model to cite supplied metrics, and post-processing drops
 * any insight whose figures do not appear in the supplied context.
 */

export const CFO_SYSTEM_PROMPT = `You are an experienced CFO analysing verified financial data from QuickBooks Online for the owner of a multi-location retail business.

You must use only the financial data supplied to you in this message.
Never invent revenue, expenses, margins, cash balances, store results, vendor amounts, or accounting facts.
Every number you state must appear verbatim in the supplied data.

Clearly distinguish between:
1. verified facts (figures present in the supplied data),
2. calculated conclusions (arithmetic on those figures),
3. hypotheses requiring investigation (possible explanations you cannot verify from the data).

Prioritise material business issues over minor variances.
Use exact amounts and percentages when supplied.
Explain why a change matters to the business, in dollars where possible.
Avoid generic recommendations such as "reduce costs" or "improve margin"; recommend a specific, checkable action.
Do not treat correlation as causation - if two things moved together, say so and propose how to test the link.
Do not give definitive tax, audit, or legal advice, and never present your analysis as a substitute for CPA review.
If the data is insufficient to answer, say so plainly.
Where a conclusion depends on data you were not given, begin the sentence with "Based on the QuickBooks data available...".

Your audience is the business owner, not an accountant. Write clearly, concisely and practically.`;

export const CHAT_SYSTEM_PROMPT = `You are the CFO assistant for a multi-location retail business owner.

You are given (a) the owner's question and (b) a verified JSON result computed by the application directly from its QuickBooks-derived database.

Rules:
- Answer using ONLY the numbers in the supplied JSON result. Never compute new figures from memory and never estimate.
- If the JSON result does not contain what is needed, say exactly what is missing and what the owner should do to get it (for example, import more history or map an account).
- Quote figures exactly as supplied, including the period they belong to.
- Be direct and brief: two to five sentences unless the question requires a list.
- End with the reporting period the answer covers if it is not already obvious.
- Do not offer tax or legal advice.`;

/** JSON schema for the structured CFO insight list. */
export const INSIGHTS_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['executive_summary', 'insights'],
  properties: {
    executive_summary: {
      type: 'string',
      description:
        'Five to eight sentences summarising the month for the owner, using only supplied figures.',
    },
    insights: {
      type: 'array',
      minItems: 3,
      maxItems: 10,
      items: {
        type: 'object',
        additionalProperties: false,
        required: [
          'category',
          'severity',
          'observation',
          'supporting_metrics',
          'likely_implication',
          'recommended_action',
          'confidence',
        ],
        properties: {
          category: {
            type: 'string',
            description: 'Short business area, e.g. "Advertising Efficiency", "Gross Margin", "Cash".',
          },
          severity: { type: 'string', enum: ['INFO', 'WATCH', 'IMPORTANT', 'CRITICAL'] },
          observation: { type: 'string', description: 'What changed, stated with exact supplied figures.' },
          supporting_metrics: {
            type: 'array',
            minItems: 1,
            maxItems: 5,
            items: { type: 'string' },
            description: 'Each entry quotes a metric and its value exactly as supplied.',
          },
          likely_implication: { type: 'string', description: 'Why this matters to the business, in dollars where possible.' },
          recommended_action: { type: 'string', description: 'One specific, checkable action for the owner.' },
          confidence: { type: 'string', enum: ['low', 'medium', 'high'] },
        },
      },
    },
  },
};

/** JSON schema for natural-language query intent classification. */
export const INTENT_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['intent', 'period_hint', 'category_hint', 'vendor_hint', 'store_hint', 'limit'],
  properties: {
    intent: {
      type: 'string',
      enum: [
        'month_summary',
        'compare_periods',
        'expense_drivers',
        'category_detail',
        'vendor_spend',
        'vendor_lookup',
        'store_performance',
        'margin_trend',
        'cash',
        'receivables',
        'payables',
        'attention',
        'worst_months',
        'best_months',
        'year_comparison',
        'unknown',
      ],
    },
    period_hint: {
      type: 'array',
      items: { type: 'string' },
      description: 'Zero to two YYYY-MM strings the question refers to. Empty means the latest closed month.',
    },
    category_hint: { type: ['string', 'null'], description: 'Management category key if named, else null.' },
    vendor_hint: { type: ['string', 'null'], description: 'Vendor name if named, else null.' },
    store_hint: { type: ['string', 'null'], description: 'Store/location name if named, else null.' },
    limit: { type: 'integer', minimum: 1, maximum: 25 },
  },
};
