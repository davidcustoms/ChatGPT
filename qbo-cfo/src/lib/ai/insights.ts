import { AppError } from '../errors';
import { logger } from '../logger';
import { event } from '../observability';
import type { AiInsight, Severity } from '../finance/types';
import type { ReportPayload } from '../reports/types';
import { aiModelName, structuredCompletion } from './client';
import { buildAiContext } from './context';
import { CFO_SYSTEM_PROMPT, INSIGHTS_SCHEMA } from './prompts';
import { isOpenAiConfigured } from '../env';
import { AI_PROMPT_VERSION, DETERMINISTIC_PROMPT_VERSION } from '../version';

interface RawInsightResponse {
  executive_summary: string;
  insights: Array<{
    category: string;
    severity: Severity;
    observation: string;
    supporting_metrics: string[];
    likely_implication: string;
    recommended_action: string;
    confidence: 'low' | 'medium' | 'high';
  }>;
}

/**
 * Extracts money/percentage literals from model output so they can be checked
 * against the figures the application supplied.
 */
export function extractFigures(text: string): string[] {
  // Thousands separators are matched in groups so a sentence-ending comma is
  // not swallowed into the figure -- "$842,503," must normalise to "$842,503",
  // otherwise a correctly-sourced amount would be treated as invented.
  const matches = text.match(
    /-?\$\d{1,3}(?:,\d{3})*(?:\.\d+)?|-?\$\d+(?:\.\d+)?|-?\d+(?:\.\d+)?%|-?\d+(?:\.\d+)?\s?pts/g,
  );
  return matches ? matches.map((m) => m.trim()) : [];
}

function normaliseFigure(value: string): string {
  return value.replace(/\s+/g, '').replace(/\.00$/, '');
}

/**
 * Guardrail: drop any insight quoting a figure that was not supplied.
 *
 * This is the enforcement behind "never allow the LLM to invent financial
 * numbers" -- a hallucinated amount removes the whole insight rather than
 * being shown to the owner.
 */
export function filterHallucinatedInsights(
  insights: AiInsight[],
  allowedFigures: Set<string>,
): { kept: AiInsight[]; dropped: AiInsight[] } {
  const allowed = new Set(Array.from(allowedFigures).map(normaliseFigure));
  const kept: AiInsight[] = [];
  const dropped: AiInsight[] = [];

  for (const insight of insights) {
    const text = [insight.observation, ...insight.supportingMetrics, insight.likelyImplication].join(' ');
    const figures = extractFigures(text).map(normaliseFigure);
    // Small percentages are frequently the result of legitimate arithmetic on
    // supplied values (e.g. a ratio of two supplied dollar amounts), so only
    // dollar amounts are strictly matched.
    const unverifiedDollars = figures.filter((f) => f.startsWith('$') && !allowed.has(f));
    if (unverifiedDollars.length > 0) dropped.push(insight);
    else kept.push(insight);
  }
  return { kept, dropped };
}

/** Deterministic fallback used when AI is unavailable or fails. */
export function fallbackInsights(report: ReportPayload): AiInsight[] {
  return report.anomalies.slice(0, 7).map((a) => ({
    category: a.category,
    severity: a.severity,
    observation: `${a.title}. ${a.detail}`,
    supportingMetrics: [
      a.currentValue !== null ? `${a.metricKey ?? 'metric'}: ${a.currentValue}` : '',
      a.comparisonValue !== null ? `comparison: ${a.comparisonValue}` : '',
    ].filter(Boolean),
    likelyImplication:
      'Based on the QuickBooks data available, this movement is large enough to change the month’s result and warrants review.',
    recommendedAction:
      'Review the underlying transactions for this item and confirm the classification with your bookkeeper.',
    confidence: 'medium' as const,
  }));
}

export interface InsightResult {
  insights: AiInsight[];
  executiveSummary: string;
  model: string;
  /** Recorded on the report version for auditability. */
  promptVersion: string;
  aiUsed: boolean;
  droppedCount: number;
  /** Insights removed because their category's mapping coverage is too poor. */
  suppressedForCoverage: number;
  warning: string | null;
}

/**
 * Removes insights about categories whose mapping coverage is too low to
 * support a conclusion. An advertising insight is worthless -- worse, actively
 * misleading -- when a third of advertising-like spend never reached the
 * Advertising category.
 */
export function filterLowCoverageInsights(
  insights: AiInsight[],
  restrictedCategories: string[],
  categoryLabels: Map<string, string>,
): { kept: AiInsight[]; suppressed: AiInsight[] } {
  if (restrictedCategories.length === 0) return { kept: insights, suppressed: [] };
  const restrictedLabels = restrictedCategories.map(
    (k) => (categoryLabels.get(k) ?? k).toLowerCase(),
  );
  const kept: AiInsight[] = [];
  const suppressed: AiInsight[] = [];
  for (const insight of insights) {
    const haystack = `${insight.category} ${insight.observation}`.toLowerCase();
    if (restrictedLabels.some((label) => haystack.includes(label))) suppressed.push(insight);
    else kept.push(insight);
  }
  return { kept, suppressed };
}

/**
 * Generates CFO commentary for a completed report payload.
 * Never throws: a failure degrades to the deterministic fallback so the
 * monthly report still completes.
 */
export async function generateInsights(report: ReportPayload): Promise<InsightResult> {
  const context = buildAiContext(report);
  const fallbackSummary = report.observations.join(' ');

  const categoryLabels = new Map(
    report.mappingCoverage.byCategory.map((c) => [c.categoryKey, c.label]),
  );

  if (!isOpenAiConfigured()) {
    return {
      insights: fallbackInsights(report),
      executiveSummary: fallbackSummary,
      model: 'deterministic',
      promptVersion: DETERMINISTIC_PROMPT_VERSION,
      aiUsed: false,
      droppedCount: 0,
      suppressedForCoverage: 0,
      warning: 'OPENAI_API_KEY is not configured, so the report uses application-computed commentary only.',
    };
  }

  try {
    const raw = await structuredCompletion<RawInsightResponse>({
      system: CFO_SYSTEM_PROMPT,
      schemaName: 'cfo_monthly_analysis',
      schema: INSIGHTS_SCHEMA,
      user: [
        'Analyse the month below and produce (1) an executive summary and (2) prioritised CFO insights.',
        'Every figure you state must appear in the data below, character for character.',
        'The deterministic alerts have already been computed; explain what they mean rather than restating them.',
        '',
        context.text,
      ].join('\n'),
    });

    const mapped: AiInsight[] = raw.insights.map((i) => ({
      category: i.category,
      severity: i.severity,
      observation: i.observation,
      supportingMetrics: i.supporting_metrics,
      likelyImplication: i.likely_implication,
      recommendedAction: i.recommended_action,
      confidence: i.confidence,
    }));

    const { kept: verified, dropped } = filterHallucinatedInsights(mapped, context.allowedFigures);
    if (dropped.length > 0) {
      event('ai.output_rejected', {
        companyId: report.companyId,
        period: report.period.start,
        count: dropped.length,
        reason: 'insight cited an amount not present in the verified context',
      });
    }

    const { kept, suppressed } = filterLowCoverageInsights(
      verified,
      context.restrictedCategories,
      categoryLabels,
    );
    if (suppressed.length > 0) {
      logger.warn('suppressed AI insights for poor mapping coverage', {
        suppressedCount: suppressed.length,
        companyId: report.companyId,
        categories: context.restrictedCategories,
      });
    }

    const summaryFigures = extractFigures(raw.executive_summary)
      .map(normaliseFigure)
      .filter((f) => f.startsWith('$'));
    const allowed = new Set(Array.from(context.allowedFigures).map(normaliseFigure));
    const summaryValid = summaryFigures.every((f) => allowed.has(f));

    const warnings: string[] = [];
    if (!summaryValid) {
      warnings.push(
        'The AI summary referenced figures not present in the verified data and was replaced with the application-computed summary.',
      );
    }
    if (dropped.length > 0) {
      warnings.push(`${dropped.length} AI insight(s) were dropped for citing unverified amounts.`);
    }
    if (suppressed.length > 0) {
      warnings.push(
        `${suppressed.length} AI insight(s) were withheld because mapping coverage for ${context.restrictedCategories.join(', ')} is too low to support a conclusion.`,
      );
    }

    return {
      insights: kept.length > 0 ? kept : fallbackInsights(report),
      executiveSummary: summaryValid ? raw.executive_summary : fallbackSummary,
      model: aiModelName(),
      promptVersion: AI_PROMPT_VERSION,
      aiUsed: true,
      droppedCount: dropped.length,
      suppressedForCoverage: suppressed.length,
      warning: warnings.length > 0 ? warnings.join(' ') : null,
    };
  } catch (err) {
    const message = err instanceof AppError ? err.message : 'AI analysis failed';
    event('ai.failed', { companyId: report.companyId, period: report.period.start, reason: message });
    return {
      insights: fallbackInsights(report),
      executiveSummary: fallbackSummary,
      model: 'deterministic',
      promptVersion: DETERMINISTIC_PROMPT_VERSION,
      aiUsed: false,
      droppedCount: 0,
      suppressedForCoverage: 0,
      warning: `${message} The report was completed using application-computed commentary.`,
    };
  }
}
