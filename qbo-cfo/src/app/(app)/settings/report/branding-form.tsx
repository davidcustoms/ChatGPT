'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input, Label } from '@/components/ui/field';
import { ErrorNotice } from '@/components/ui/states';

interface Branding {
  businessName: string | null;
  logoDataUrl: string | null;
  reportTitleTemplate: string;
  primaryColor: string;
  footerText: string | null;
  confidential: boolean;
}

const MAX_LOGO_BYTES = 300_000;

export function BrandingForm({ companyId, initial }: { companyId: string; initial: Branding }) {
  const router = useRouter();
  const [form, setForm] = React.useState(initial);
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [saved, setSaved] = React.useState(false);

  async function onLogo(file: File | null) {
    if (!file) {
      setForm({ ...form, logoDataUrl: null });
      return;
    }
    if (file.size > MAX_LOGO_BYTES) {
      setError(`Logo must be under ${Math.round(MAX_LOGO_BYTES / 1000)} KB.`);
      return;
    }
    const reader = new FileReader();
    reader.onload = () => setForm({ ...form, logoDataUrl: String(reader.result) });
    reader.readAsDataURL(file);
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);
    setSaved(false);
    try {
      const res = await fetch('/api/settings/branding', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ companyId, ...form }),
      });
      const data = (await res.json()) as { error?: { message?: string } };
      if (!res.ok) {
        setError(data.error?.message ?? 'Could not save branding.');
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
    <form onSubmit={save} className="space-y-4">
      {error ? <ErrorNotice message={error} /> : null}
      <div className="space-y-1.5">
        <Label htmlFor="business-name">Business name on reports</Label>
        <Input
          id="business-name"
          value={form.businessName ?? ''}
          maxLength={200}
          onChange={(e) => setForm({ ...form, businessName: e.target.value || null })}
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="title-template">Report title template</Label>
        <Input
          id="title-template"
          value={form.reportTitleTemplate}
          maxLength={200}
          onChange={(e) => setForm({ ...form, reportTitleTemplate: e.target.value })}
        />
        <p className="text-xs text-ink-subtle">
          {'Placeholders: {month}, {year}, {company}. Example: "August 2026 Executive Financial Report".'}
        </p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="primary-color">Primary report colour</Label>
          <div className="flex items-center gap-2">
            <input
              id="primary-color"
              type="color"
              value={form.primaryColor}
              onChange={(e) => setForm({ ...form, primaryColor: e.target.value })}
              className="h-9 w-12 rounded border border-border-strong"
            />
            <Input
              value={form.primaryColor}
              maxLength={7}
              onChange={(e) => setForm({ ...form, primaryColor: e.target.value })}
              aria-label="Primary colour hex value"
            />
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="logo">Logo (PNG, JPEG or SVG)</Label>
          <input
            id="logo"
            type="file"
            accept="image/png,image/jpeg,image/svg+xml"
            onChange={(e) => void onLogo(e.target.files?.[0] ?? null)}
            className="block w-full text-xs text-ink-muted file:mr-3 file:rounded-md file:border file:border-border-strong file:bg-surface file:px-3 file:py-1.5 file:text-xs"
          />
          {form.logoDataUrl ? (
            <div className="flex items-center gap-2">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={form.logoDataUrl} alt="Current report logo" className="h-8 w-auto" />
              <button
                type="button"
                onClick={() => setForm({ ...form, logoDataUrl: null })}
                className="text-xs text-negative hover:underline"
              >
                Remove
              </button>
            </div>
          ) : null}
        </div>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="footer">Footer text</Label>
        <Input
          id="footer"
          value={form.footerText ?? ''}
          maxLength={300}
          onChange={(e) => setForm({ ...form, footerText: e.target.value || null })}
        />
      </div>
      <label className="flex items-center gap-2 text-sm text-ink-muted">
        <input
          type="checkbox"
          checked={form.confidential}
          onChange={(e) => setForm({ ...form, confidential: e.target.checked })}
          className="h-4 w-4"
        />
        Mark reports &quot;Confidential&quot;
      </label>
      <div className="flex items-center gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? 'Saving…' : 'Save branding'}
        </Button>
        {saved ? <span className="text-xs text-positive">Saved.</span> : null}
      </div>
    </form>
  );
}
