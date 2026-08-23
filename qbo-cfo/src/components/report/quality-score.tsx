import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import type { QualityScore } from '@/lib/finance/quality-score';

const BAND_STYLE: Record<string, { bar: string; badge: 'positive' | 'info' | 'warning' | 'negative' }> = {
  excellent: { bar: 'bg-positive', badge: 'positive' },
  good: { bar: 'bg-info', badge: 'info' },
  needs_review: { bar: 'bg-warning', badge: 'warning' },
  low: { bar: 'bg-negative', badge: 'negative' },
};

/**
 * Report confidence, 0-100.
 *
 * Every lost point is shown with the factor and reason that removed it, so the
 * score is actionable rather than a verdict. The score is computed by the
 * application; no AI output can change it.
 */
export function QualityScoreCard({
  score,
  compact = false,
  className,
}: {
  score: QualityScore;
  compact?: boolean;
  className?: string;
}) {
  const style = BAND_STYLE[score.band] ?? BAND_STYLE['low']!;

  if (compact) {
    return (
      <span className="inline-flex items-center gap-2">
        <Badge variant={style.badge}>
          {score.score}/100 · {score.bandLabel}
        </Badge>
      </span>
    );
  }

  return (
    <Card className={className}>
      <CardHeader>
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <CardTitle>Report confidence</CardTitle>
          <Badge variant={style.badge}>{score.bandLabel}</Badge>
        </div>
      </CardHeader>
      <CardContent>
        <div className="flex items-baseline gap-2">
          <span className="text-3xl font-semibold tnum text-navy-800">{score.score}</span>
          <span className="text-sm text-ink-muted">/ 100</span>
        </div>
        <div
          className="mt-2 h-2 w-full overflow-hidden rounded-full bg-surface-muted"
          role="progressbar"
          aria-valuenow={score.score}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label="Report confidence score"
        >
          <div className={cn('h-full rounded-full transition-all', style.bar)} style={{ width: `${score.score}%` }} />
        </div>

        <p className="mt-3 text-xs text-ink-muted">
          Confidence reflects the cleanliness of the underlying bookkeeping, not the accuracy of the
          calculations. It is computed deterministically from eight factors; the AI layer cannot change it.
        </p>

        {score.deductions.length === 0 ? (
          <p className="mt-3 text-sm text-positive">No deductions — every scored factor is clean.</p>
        ) : (
          <ul className="mt-3 space-y-2">
            {score.deductions.map((d) => (
              <li key={`${d.factor}-${d.label}`} className="flex gap-3 border-b border-border pb-2 last:border-0 last:pb-0">
                <span className="shrink-0 rounded bg-negative-soft px-1.5 py-0.5 text-[11px] font-semibold tnum text-negative">
                  −{d.points}
                </span>
                <span className="text-xs">
                  <span className="font-medium text-ink">{d.label}.</span>{' '}
                  <span className="text-ink-muted">{d.reason}</span>
                </span>
              </li>
            ))}
          </ul>
        )}

        <dl className="mt-4 grid grid-cols-2 gap-2 border-t border-border pt-3 text-[11px] text-ink-muted">
          <div className="flex justify-between gap-2"><dt>90–100</dt><dd>Excellent</dd></div>
          <div className="flex justify-between gap-2"><dt>75–89</dt><dd>Good</dd></div>
          <div className="flex justify-between gap-2"><dt>60–74</dt><dd>Needs Review</dd></div>
          <div className="flex justify-between gap-2"><dt>Below 60</dt><dd>Low Confidence</dd></div>
        </dl>
      </CardContent>
    </Card>
  );
}
