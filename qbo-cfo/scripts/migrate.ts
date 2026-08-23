/**
 * Applies db/schema.sql and bootstraps the owner account.
 *   npm run db:migrate
 */
import { runMigrations, ensureOwnerUser } from '../src/lib/db/migrate';
import { getPool } from '../src/lib/db/pool';

async function main(): Promise<void> {
  await runMigrations();
  const owner = await ensureOwnerUser();
  if (owner.created) {
    console.log(`Created owner account: ${owner.email}`);
  } else {
    console.log('Owner account already exists; schema is up to date.');
  }
  await getPool().end();
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
