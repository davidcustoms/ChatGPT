import { getPageContext, type SearchParams } from '@/lib/page-context';
import { env } from '@/lib/env';
import { AgingPage } from '@/components/report/aging-page';

export const dynamic = 'force-dynamic';

export default async function ReceivablesPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const ctx = await getPageContext(sp);
  return <AgingPage ctx={ctx} kind="receivable" demoEnabled={env().DEMO_MODE} />;
}
