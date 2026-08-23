'use client';

import * as React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  BarChart3,
  Building2,
  CalendarCheck,
  CreditCard,
  FileText,
  LayoutDashboard,
  MessageSquare,
  Receipt,
  Settings,
  ShoppingBag,
  Wallet,
} from 'lucide-react';
import { cn } from '@/lib/utils';

const NAV_SECTIONS: Array<{
  title: string;
  items: Array<{ href: string; label: string; icon: React.ComponentType<{ className?: string }> }>;
}> = [
  {
    title: 'Overview',
    items: [
      { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
      { href: '/reports', label: 'Reports', icon: FileText },
      { href: '/cfo-chat', label: 'Ask Your CFO', icon: MessageSquare },
    ],
  },
  {
    title: 'Analysis',
    items: [
      { href: '/stores', label: 'Stores', icon: Building2 },
      { href: '/expenses', label: 'Expenses', icon: Receipt },
      { href: '/vendors', label: 'Vendors', icon: ShoppingBag },
      { href: '/receivables', label: 'Receivables', icon: Wallet },
      { href: '/payables', label: 'Payables', icon: CreditCard },
    ],
  },
  {
    title: 'Review',
    items: [
      { href: '/transactions-review', label: 'Transactions', icon: BarChart3 },
      { href: '/monthly-close', label: 'Monthly Close', icon: CalendarCheck },
    ],
  },
  {
    title: 'Configure',
    items: [{ href: '/settings', label: 'Settings', icon: Settings }],
  },
];

export function SideNav({ companyId }: { companyId?: string | null }) {
  const pathname = usePathname();
  const withCompany = (href: string) => (companyId ? `${href}?company=${companyId}` : href);

  return (
    <nav aria-label="Main" className="flex h-full flex-col gap-5 px-3 py-4">
      {NAV_SECTIONS.map((section) => (
        <div key={section.title}>
          <p className="px-3 pb-1.5 text-[10px] font-semibold uppercase tracking-widest text-navy-200">
            {section.title}
          </p>
          <ul className="space-y-0.5">
            {section.items.map((item) => {
              const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
              const Icon = item.icon;
              return (
                <li key={item.href}>
                  <Link
                    href={withCompany(item.href)}
                    aria-current={active ? 'page' : undefined}
                    className={cn(
                      'flex items-center gap-2.5 rounded-md px-3 py-1.5 text-sm transition-colors',
                      active
                        ? 'bg-navy-600 font-medium text-white'
                        : 'text-navy-100 hover:bg-navy-600/50 hover:text-white',
                    )}
                  >
                    <Icon className="h-4 w-4 shrink-0" />
                    {item.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}
