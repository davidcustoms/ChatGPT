import { getPageContext, type SearchParams } from '@/lib/page-context';
import { env, isOpenAiConfigured } from '@/lib/env';
import { PageHeader, DataProvenance } from '@/components/layout/page-header';
import { NoDataState } from '@/components/layout/no-data';
import { InfoNotice } from '@/components/ui/states';
import { ChatPanel } from './chat-panel';

export const dynamic = 'force-dynamic';

const SUGGESTIONS = [
  'How did we do last month?',
  'Why did profit go down?',
  'Which expense increased the most?',
  'Which store performed best?',
  'Which store has the highest payroll percentage?',
  'What did we spend on advertising this year?',
  'Who are our largest vendors?',
  'What is our gross margin trend?',
  'Are expenses growing faster than sales?',
  'What should I pay attention to this month?',
  'Show me our worst three months.',
  'Compare this year to last year.',
  'What happened to cash?',
  'Which overdue receivables need attention?',
];

export default async function CfoChatPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const ctx = await getPageContext(sp);

  if (!ctx.company || !ctx.hasData) {
    return (
      <>
        <PageHeader title="Ask Your CFO" />
        <NoDataState demoEnabled={env().DEMO_MODE} hasCompany={Boolean(ctx.company)} />
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Ask Your CFO"
        description={<DataProvenance dataThrough={ctx.dataThrough} source={ctx.sourceLabel} />}
      />
      {!isOpenAiConfigured() ? (
        <InfoNotice className="mb-4">
          OPENAI_API_KEY is not configured. Questions are still answered — the application computes the answer
          from your stored accounting data — but the wording will be plain rather than conversational.
        </InfoNotice>
      ) : null}
      <ChatPanel
        companyId={ctx.company.id}
        suggestions={SUGGESTIONS}
        dataThrough={ctx.dataThrough}
        source={ctx.sourceLabel}
      />
    </>
  );
}
