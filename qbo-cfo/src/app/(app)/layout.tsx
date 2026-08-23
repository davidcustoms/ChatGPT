import Link from 'next/link';
import { requireUserPage } from '@/lib/auth/guards';
import { listCompaniesForUser } from '@/lib/db/repositories/companies';
import { CompanySwitcher } from '@/components/layout/company-switcher';
import { SideNav } from '@/components/layout/nav';
import { signOut } from '@/app/login/actions';

export const dynamic = 'force-dynamic';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUserPage();
  const companies = await listCompaniesForUser(user.id);

  return (
    <div className="flex min-h-screen bg-canvas">
      <aside className="no-print sticky top-0 hidden h-screen w-56 shrink-0 flex-col bg-navy-800 lg:flex">
        <div className="px-5 py-5">
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-navy-200">
            QuickBooks
          </p>
          <p className="text-sm font-semibold text-white">CFO Reporting Agent</p>
        </div>
        <div className="flex-1 overflow-y-auto scrollbar-thin">
          <SideNav />
        </div>
        <div className="border-t border-navy-600/60 px-5 py-3">
          <p className="truncate text-xs text-navy-100">{user.email}</p>
          <form action={signOut}>
            <button type="submit" className="mt-1 text-xs text-navy-200 hover:text-white">
              Sign out
            </button>
          </form>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="no-print sticky top-0 z-20 flex flex-wrap items-center justify-between gap-3 border-b border-border bg-surface/90 px-4 py-2.5 backdrop-blur lg:px-8">
          <div className="flex items-center gap-3 lg:hidden">
            <Link href="/dashboard" className="text-sm font-semibold text-navy-800">
              CFO Reporting Agent
            </Link>
          </div>
          <div className="flex flex-1 items-center justify-end gap-3">
            <CompanySwitcher
              companies={companies.map((c) => ({ id: c.id, name: c.name, isDemo: c.isDemo }))}
            />
            <span className="rounded-full border border-border bg-surface-muted px-2 py-0.5 text-[11px] text-ink-muted">
              Read-only
            </span>
          </div>
        </header>

        <nav aria-label="Main (compact)" className="no-print border-b border-border bg-surface px-4 py-2 lg:hidden">
          <ul className="flex gap-3 overflow-x-auto text-xs scrollbar-thin">
            {[
              ['/dashboard', 'Dashboard'],
              ['/reports', 'Reports'],
              ['/cfo-chat', 'Ask CFO'],
              ['/stores', 'Stores'],
              ['/expenses', 'Expenses'],
              ['/vendors', 'Vendors'],
              ['/receivables', 'A/R'],
              ['/payables', 'A/P'],
              ['/transactions-review', 'Review'],
              ['/monthly-close', 'Close'],
              ['/settings', 'Settings'],
            ].map(([href, label]) => (
              <li key={href}>
                <Link href={href as string} className="whitespace-nowrap text-ink-muted hover:text-navy-700">
                  {label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>

        <main id="main" className="min-w-0 flex-1 px-4 py-6 lg:px-8">
          {children}
        </main>
      </div>
    </div>
  );
}
