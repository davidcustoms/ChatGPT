'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input, Label } from '@/components/ui/field';
import { ErrorNotice } from '@/components/ui/states';

export interface RuleView {
  key: string;
  label: string;
  description: string;
  paramLabels: Record<string, string>;
  defaults: Record<string, number>;
  enabled: boolean;
  params: Record<string, number>;
}

export function ThresholdEditor({ companyId, rule }: { companyId: string; rule: RuleView }) {
  const router = useRouter();
  const [enabled, setEnabled] = React.useState(rule.enabled);
  const [params, setParams] = React.useState<Record<string, number>>({ ...rule.params });
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [saved, setSaved] = React.useState(false);

  const dirty =
    enabled !== rule.enabled ||
    Object.keys(rule.defaults).some((k) => (params[k] ?? 0) !== (rule.params[k] ?? 0));

  async function save() {
    setPending(true);
    setError(null);
    setSaved(false);
    try {
      const res = await fetch('/api/settings/thresholds', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ companyId, ruleKey: rule.key, enabled, params }),
      });
      const data = (await res.json()) as { error?: { message?: string } };
      if (!res.ok) {
        setError(data.error?.message ?? 'Could not save the threshold.');
        return;
      }
      setSaved(true);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error.');
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="rounded-md border border-border p-3">
      {error ? <ErrorNotice message={error} /> : null}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-ink">{rule.label}</p>
          <p className="mt-0.5 max-w-xl text-xs text-ink-muted">{rule.description}</p>
        </div>
        <label className="flex items-center gap-2 text-xs text-ink-muted">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
            className="h-3.5 w-3.5"
          />
          Enabled
        </label>
      </div>

      <div className="mt-3 grid gap-3 sm:grid-cols-3">
        {Object.entries(rule.defaults).map(([name]) => (
          <div key={name} className="space-y-1">
            <Label htmlFor={`${rule.key}-${name}`}>{rule.paramLabels[name] ?? name}</Label>
            <Input
              id={`${rule.key}-${name}`}
              type="number"
              step="any"
              value={params[name] ?? 0}
              onChange={(e) => setParams({ ...params, [name]: Number(e.target.value) })}
              className="h-8 text-xs"
            />
            <p className="text-[11px] text-ink-subtle">Default: {rule.defaults[name]}</p>
          </div>
        ))}
      </div>

      <div className="mt-3 flex items-center gap-3">
        <Button size="sm" onClick={save} disabled={pending || !dirty}>
          {pending ? 'Saving…' : 'Save'}
        </Button>
        {saved ? <span className="text-xs text-positive">Saved.</span> : null}
      </div>
    </div>
  );
}
