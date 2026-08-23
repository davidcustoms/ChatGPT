import { describe, expect, it } from 'vitest';
import { extractFigures, fallbackInsights, filterHallucinatedInsights } from '@/lib/ai/insights';
import { buildAiContext } from '@/lib/ai/context';
import { CFO_SYSTEM_PROMPT, CHAT_SYSTEM_PROMPT, INSIGHTS_SCHEMA } from '@/lib/ai/prompts';
import type { AiInsight } from '@/lib/finance/types';
import { reportPayload as payload } from './fixtures/report';

function insight(overrides: Partial<AiInsight> = {}): AiInsight {
  return {
    category: 'Advertising Efficiency',
    severity: 'IMPORTANT',
    observation: 'Advertising increased to $52,841 from $38,245.',
    supportingMetrics: ['Advertising: $52,841'],
    likelyImplication: 'Acquisition cost rose.',
    recommendedAction: 'Review campaign-level spend.',
    confidence: 'high',
    ...overrides,
  };
}

describe('figure extraction', () => {
  it('finds dollar amounts, percentages and point moves', () => {
    const figures = extractFigures('Revenue was $842,503, up 12.4%, with margin down 1.1 pts.');
    expect(figures).toContain('$842,503');
    expect(figures).toContain('12.4%');
    expect(figures.some((f) => f.includes('pts'))).toBe(true);
  });

  it('returns nothing for prose without numbers', () => {
    expect(extractFigures('Margins deteriorated somewhat.')).toEqual([]);
  });
});

describe('hallucination guardrail', () => {
  const allowed = new Set(['$52,841', '$38,245', '$681,370']);

  it('keeps an insight whose amounts were all supplied', () => {
    const { kept, dropped } = filterHallucinatedInsights([insight()], allowed);
    expect(kept).toHaveLength(1);
    expect(dropped).toHaveLength(0);
  });

  it('drops an insight citing an amount that was never supplied', () => {
    const invented = insight({ observation: 'Advertising increased to $99,999 this month.' });
    const { kept, dropped } = filterHallucinatedInsights([invented], allowed);
    expect(kept).toHaveLength(0);
    expect(dropped).toHaveLength(1);
  });

  it('checks the supporting metrics and the implication, not just the observation', () => {
    const invented = insight({ supportingMetrics: ['Cash: $1,234,567'] });
    expect(filterHallucinatedInsights([invented], allowed).dropped).toHaveLength(1);

    const inventedImplication = insight({ likelyImplication: 'That is $250,000 of lost profit.' });
    expect(filterHallucinatedInsights([inventedImplication], allowed).dropped).toHaveLength(1);
  });

  it('tolerates trailing cents formatting differences', () => {
    const withCents = insight({ observation: 'Advertising reached $52,841.00 this month.' });
    expect(filterHallucinatedInsights([withCents], allowed).kept).toHaveLength(1);
  });

  it('allows derived percentages, which are arithmetic on supplied values', () => {
    const derived = insight({ observation: 'Advertising rose 38.2% to $52,841.' });
    expect(filterHallucinatedInsights([derived], allowed).kept).toHaveLength(1);
  });
});

describe('AI context', () => {
  const ctx = buildAiContext(payload());

  it('states the source and the period the data covers', () => {
    expect(ctx.text).toContain('DATA SOURCE: QuickBooks Online, data through 2026-07-31');
    expect(ctx.text).toContain('REPORTING PERIOD: July 2026');
  });

  it('collects every figure the model is permitted to quote', () => {
    expect(ctx.allowedFigures.has('$681,370')).toBe(true);
    expect(ctx.allowedFigures.has('$557,555')).toBe(true);
    expect(ctx.allowedFigures.has('45.0%')).toBe(true);
  });

  it('forbids inventing a cash flow split when none was supplied', () => {
    expect(ctx.text).toContain('Cash flow statement available: no');
    expect(ctx.text).toMatch(/Do NOT state operating, investing or financing cash flow figures/);
  });
});

describe('prompts', () => {
  it('instructs the model to use only supplied data', () => {
    expect(CFO_SYSTEM_PROMPT).toMatch(/only the financial data supplied/i);
    expect(CFO_SYSTEM_PROMPT).toMatch(/Never invent/i);
    expect(CFO_SYSTEM_PROMPT).toMatch(/verified facts/i);
    expect(CFO_SYSTEM_PROMPT).toMatch(/hypotheses/i);
    expect(CFO_SYSTEM_PROMPT).toMatch(/correlation as causation/i);
    expect(CFO_SYSTEM_PROMPT).toMatch(/tax, audit, or legal advice/i);
    expect(CFO_SYSTEM_PROMPT).toMatch(/Based on the QuickBooks data available/);
  });

  it('forbids the chat layer from computing its own numbers', () => {
    expect(CHAT_SYSTEM_PROMPT).toMatch(/ONLY the numbers in the supplied JSON/);
    expect(CHAT_SYSTEM_PROMPT).toMatch(/never estimate/i);
  });

  it('requires every insight to carry the documented fields', () => {
    const item = (INSIGHTS_SCHEMA as { properties: { insights: { items: { required: string[] } } } })
      .properties.insights.items.required;
    expect(item).toEqual([
      'category',
      'severity',
      'observation',
      'supporting_metrics',
      'likely_implication',
      'recommended_action',
      'confidence',
    ]);
  });
});

describe('deterministic fallback', () => {
  it('produces commentary from the anomaly list when AI is unavailable', () => {
    const p = payload();
    p.anomalies = [
      {
        ruleKey: 'cash_decline',
        severity: 'IMPORTANT',
        category: 'Cash',
        title: 'Cash declined 15.2%',
        detail: 'Cash fell $99,955.',
        metricKey: 'cash',
        currentValue: 557_555,
        comparisonValue: 657_510,
        deltaAmount: -99_955,
        deltaPct: -0.152,
        score: 40,
        evidence: {},
      },
    ];
    const fallback = fallbackInsights(p);
    expect(fallback).toHaveLength(1);
    expect(fallback[0]?.observation).toContain('Cash declined 15.2%');
    expect(fallback[0]?.likelyImplication).toMatch(/Based on the QuickBooks data available/);
  });
});
