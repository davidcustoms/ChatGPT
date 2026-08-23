/**
 * Test environment defaults.
 *
 * Unit tests must not require a database or real credentials. These defaults
 * fill in only what the environment schema demands, and never overwrite a real
 * value, so the integration suites still use the DATABASE_URL you provide.
 */
if (!process.env['DATABASE_URL']) {
  // Marks the URL as a placeholder so the integration suites skip rather than
  // attempting to connect to a database that does not exist.
  process.env['DATABASE_URL'] = 'postgresql://unit-tests@127.0.0.1:1/none';
  process.env['DATABASE_URL_IS_PLACEHOLDER'] = '1';
}
process.env['NEXT_PUBLIC_APP_URL'] ??= 'http://localhost:3000';
process.env['TOKEN_ENCRYPTION_KEY'] ??= Buffer.from('unit-test-encryption-key-32bytes').toString('base64');
process.env['SESSION_SECRET'] ??= Buffer.from('unit-test-session-secret-32bytes').toString('base64');
process.env['INTUIT_ENVIRONMENT'] ??= 'sandbox';
process.env['DEMO_MODE'] ??= 'true';
