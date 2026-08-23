# Connecting a production QuickBooks company

Everything you have to do by hand, in order. Nothing here should be pasted into
a chat window — secrets go into your environment file or your deployment
platform's secret store only.

Budget about 20 minutes, plus Intuit's review time if your app has not been
through it before.

---

## 1. Intuit Developer account

1. Sign in at **https://developer.intuit.com** with the Intuit ID that has
   access to the QuickBooks company you want to connect.
2. Go to **Dashboard → My Apps**.
3. Either open your existing app or **Create an app → QuickBooks Online and
   Payments**.

When asked which scopes the app needs, select **`com.intuit.quickbooks.accounting`
and nothing else**. Do not select Payments, Payroll, or the OpenID scopes.

> Intuit has no read-only accounting scope — accounting is read/write at their
> granularity. The read-only guarantee is enforced in this application:
> `src/lib/qbo/client.ts` issues `GET` only, refuses any path matching
> `create|update|delete|void|batch|sparse|upload`, and refuses any query that
> is not a `SELECT`. That is covered by `tests/qbo-client.test.ts` and
> `tests/connection-failures.test.ts`.

## 2. Production keys

In your app: **Keys & credentials → Production**.

Production keys are only issued once the app passes Intuit's checks. If the
Production tab is greyed out, complete the items Intuit lists there first —
typically the app's name, description, End User License Agreement URL, privacy
policy URL, host domain, and the technical questionnaire.

Copy two values:

| Intuit calls it | You need it as |
|---|---|
| **Client ID** | `INTUIT_CLIENT_ID` |
| **Client Secret** | `INTUIT_CLIENT_SECRET` |

## 3. Redirect URI

Still under **Keys & credentials → Production**, find **Redirect URIs** and add
exactly:

```
https://YOUR-DOMAIN/api/quickbooks/callback
```

Replace `YOUR-DOMAIN` with the host this application is served from. Intuit
matches this string **exactly** — scheme, host, port and path all have to be
identical to what the application sends, and a trailing slash counts as a
difference. Production redirect URIs must be `https`.

If you are validating from a laptop rather than a deployed host, use a tunnel
that gives you an https URL (`ngrok http 3000`, `cloudflared tunnel`) and
register that tunnel's URL. Re-register it whenever the tunnel URL changes.

Save the same value as `INTUIT_REDIRECT_URI`.

## 4. Host domain and launch URLs

Intuit requires these on a production app. Under **Settings** for the app:

| Field | Value |
|---|---|
| Host domain | `YOUR-DOMAIN` |
| Launch URL | `https://YOUR-DOMAIN/dashboard` |
| Disconnect URL | `https://YOUR-DOMAIN/settings/quickbooks` |
| EULA URL | your terms page |
| Privacy policy URL | your privacy page |

The last two must resolve publicly or Intuit will not release production keys.

## 5. Environment variables

Set these wherever the application runs — `.env.local` for a local run, or the
platform's secret store for a deployment. **`.env.local` is gitignored; keep it
that way.**

### Must be set for the connection to work

| Variable | Value | Notes |
|---|---|---|
| `INTUIT_ENVIRONMENT` | `production` | Switches the API base to `quickbooks.api.intuit.com`. The validation harness refuses to run against `sandbox` |
| `INTUIT_CLIENT_ID` | from step 2 | |
| `INTUIT_CLIENT_SECRET` | from step 2 | Server-side only. Never reaches the browser |
| `INTUIT_REDIRECT_URI` | from step 3 | Must equal the registered URI byte for byte |
| `NEXT_PUBLIC_APP_URL` | `https://YOUR-DOMAIN` | The origin the callback redirects back to. Must match the host in `INTUIT_REDIRECT_URI` |

### Must already be set (generate fresh for production)

| Variable | How to generate |
|---|---|
| `DATABASE_URL` | your Postgres connection string |
| `TOKEN_ENCRYPTION_KEY` | `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"` |
| `SESSION_SECRET` | same command, a different value |
| `CRON_SECRET` | same command, a different value |

Back up `TOKEN_ENCRYPTION_KEY` somewhere other than the database backup. Without
it the stored tokens cannot be decrypted and you have to reconnect.

### Should be set for a live validation run

| Variable | Value | Notes |
|---|---|---|
| `DEMO_MODE` | `false` | Stops a synthetic company appearing beside the real one |
| `OPENAI_API_KEY` | your key | Optional. Without it every figure is still produced and the commentary is the application's own |

### Sanity check before you start OAuth

```bash
curl -s https://YOUR-DOMAIN/api/health | jq '.quickbooks, .database.ok'
```

Expect `configured: true`, `environment: "production"`, `clientIdPresent: true`,
`redirectUriConfigured: true`, and `true` for the database. The endpoint reports
booleans only and never echoes a secret.

## 6. What you click during OAuth

1. Sign in to this application as the owner account.
2. Go to **Settings → QuickBooks** (`https://YOUR-DOMAIN/settings/quickbooks`).
3. Press **Connect to QuickBooks**. You are sent to Intuit.
4. On Intuit's screen:
   - sign in with the Intuit ID that has access to the company;
   - **pick the correct company from the dropdown** — this is the one step that
     cannot be undone without disconnecting and reconnecting;
   - check that the permission requested is accounting only;
   - press **Connect**.
5. Intuit returns you to `/settings/quickbooks`. You should see the company name,
   the realm id, and a token expiry.

If you land on an error page instead, the message names the cause. The usual one
is a redirect URI that does not match to the byte.

## 7. Then run the validation

```
https://YOUR-DOMAIN/validation/live-qbo
```

or from a shell with the same environment:

```bash
npm run validate:qbo          # connection, entities, reports, read-only proof
npm run validate:live         # the full production gate, writes docs/LIVE_VALIDATION.md
```

Both are read-only. `validate:live` imports history for the month under test,
which writes to *this application's* database and never to QuickBooks.

---

## Troubleshooting

| Symptom | Cause |
|---|---|
| `invalid_redirect_uri` | The registered URI is not byte-identical to `INTUIT_REDIRECT_URI`. Check scheme, port, trailing slash |
| Consent screen shows the wrong company | Wrong Intuit ID, or the right ID without access. Sign out of Intuit and retry |
| Production tab greyed out | Intuit's app checklist is incomplete — usually EULA or privacy URL |
| `invalid_client` | Sandbox keys against the production environment, or the reverse. Check `INTUIT_ENVIRONMENT` |
| Connects, then every call 401s | `INTUIT_ENVIRONMENT` does not match the keys you pasted |
| Validation refuses to start | It requires `INTUIT_ENVIRONMENT=production`. Sandbox results do not validate production behaviour |

## What Intuit sees from this application

Only `GET` requests, only to these paths:

```
/v3/company/{realmId}/companyinfo/{realmId}
/v3/company/{realmId}/query?query=SELECT ...
/v3/company/{realmId}/reports/{ProfitAndLoss|BalanceSheet|CashFlow|AgedReceivables|AgedPayables}
```

No `POST`, `PUT`, `PATCH` or `DELETE` is ever issued to a QuickBooks accounting
resource. `QuickBooksClient.request()` has no method parameter to set.
