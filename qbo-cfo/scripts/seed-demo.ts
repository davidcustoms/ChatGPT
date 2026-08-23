/**
 * Creates the synthetic demo company and generates its latest report.
 *   npm run db:seed-demo -- [months]
 */
import { getPool, queryOne } from '../src/lib/db/pool';
import { seedDemoCompany } from '../src/lib/demo/seed';
import { generateMonthlyReport } from '../src/lib/reports/generate';
import { latestMetricsPeriod } from '../src/lib/db/repositories/metrics';

async function main(): Promise<void> {
  const months = Number(process.argv[2] ?? 24);
  const owner = await queryOne<{ id: string; email: string }>(
    'SELECT id, email FROM users ORDER BY created_at LIMIT 1',
  );
  if (!owner) {
    throw new Error('No user exists. Run `npm run db:migrate` first (it creates the owner account).');
  }

  const { companyId } = await seedDemoCompany({ userId: owner.id, months });
  console.log(`Seeded demo company ${companyId} with ${months} months of synthetic data.`);

  const period = await latestMetricsPeriod(companyId);
  if (period) {
    const { reportId } = await generateMonthlyReport({
      companyId,
      period,
      requestedBy: owner.id,
      generatedBy: 'manual',
    });
    console.log(`Generated report ${reportId} for ${period.start.slice(0, 7)}.`);
  }
  await getPool().end();
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
