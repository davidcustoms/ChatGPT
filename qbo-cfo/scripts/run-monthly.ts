/**
 * Runs the monthly close for every scheduled company. Intended for a cron
 * runner that cannot call the HTTP endpoint.
 *   npm run cron:monthly -- [--force] [--company <uuid>]
 */
import { getPool } from '../src/lib/db/pool';
import { runMonthlyForAllCompanies, runMonthlyForCompany } from '../src/lib/jobs/monthly';

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const force = args.includes('--force');
  const companyIndex = args.indexOf('--company');
  const companyId = companyIndex >= 0 ? args[companyIndex + 1] : undefined;

  const results = companyId
    ? [await runMonthlyForCompany({ companyId })]
    : await runMonthlyForAllCompanies({ force });

  for (const r of results) {
    console.log(`${r.companyId} ${r.period}: ${r.status}${r.message ? ` — ${r.message}` : ''}`);
    for (const w of r.warnings.slice(0, 5)) console.log(`  warning: ${w}`);
  }
  await getPool().end();
  if (results.some((r) => r.status === 'failed')) process.exit(1);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
