import Link from 'next/link';
import { Button } from '@/components/ui/button';

export default function NotFound() {
  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <div className="max-w-md text-center">
        <p className="text-xs font-semibold uppercase tracking-widest text-ink-subtle">404</p>
        <h1 className="mt-1 text-lg font-semibold text-navy-800">Page not found</h1>
        <p className="mt-2 text-sm text-ink-muted">That page does not exist in this workspace.</p>
        <Button className="mt-4" asChild>
          <Link href="/dashboard">Back to dashboard</Link>
        </Button>
      </div>
    </main>
  );
}
