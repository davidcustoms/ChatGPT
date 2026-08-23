'use client';

import { useEffect } from 'react';
import { Button } from '@/components/ui/button';

/** Root error boundary: never leaves the user on a blank screen. */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // eslint-disable-next-line no-console
    console.error(error);
  }, [error]);

  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <div className="max-w-md rounded-[var(--radius-card)] border border-border bg-surface p-6 text-center">
        <h1 className="text-lg font-semibold text-navy-800">Something went wrong</h1>
        <p className="mt-2 text-sm text-ink-muted">
          {error.message || 'An unexpected error occurred while loading this page.'}
        </p>
        <div className="mt-4 flex justify-center gap-2">
          <Button onClick={reset}>Try again</Button>
          <Button variant="outline" asChild>
            <a href="/dashboard">Back to dashboard</a>
          </Button>
        </div>
      </div>
    </main>
  );
}
