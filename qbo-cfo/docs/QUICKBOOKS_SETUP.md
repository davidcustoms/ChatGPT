# QuickBooks Setup

How to create the Intuit application, connect a company, and what the
application reads once connected.

---

## 1. Create the Intuit app

1. Sign in at <https://developer.intuit.com>.
2. **My Apps → Create an app → QuickBooks Online and Payments**.
3. Under **Scopes**, select **only** `com.intuit.quickbooks.accounting`.

   This is the narrowest scope Intuit offers that still permits reading reports
   and entities. The application never issues a write request against it, and
   never needs `com.intuit.quickbooks.payment`.
4. Open **Keys & credentials**. There are two key sets:

   | Environment | Keys to use | `INTUIT_ENVIRONMENT` |
   |---|---|---|
   | Sandbox company | Development keys | `sandbox` |
   | Real company | Production keys | `production` |

5. Under **Redirect URIs**, add the exact URI you will configure:

   ```
   http://localhost:3000/api/quickbooks/callback          # local
   https://your-app.example.com/api/quickbooks/callback   # production
   ```

   Intuit matches this string exactly — a trailing slash or an `http` /`https`
   mismatch produces `invalid_redirect_uri` at the consent screen.

6. Copy the Client ID and Client Secret into your environment:

   ```bash
   INTUIT_CLIENT_ID=ABxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
   INTUIT_CLIENT_SECRET=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
   INTUIT_REDIRECT_URI=http://localhost:3000/api/quickbooks/callback
   INTUIT_ENVIRONMENT=sandbox
   ```

   The client secret is read only by server modules. It is never imported by a
   client component and therefore never reaches the browser bundle.

## 2. Prepare the sandbox company

Intuit creates a sandbox company automatically; find it under
**Dashboard → Sandboxes**.

For store-level reporting to work, the company must track a dimension. In the
sandbox company:

1. **Settings (gear) → Account and settings → Advanced → Categories**.
2. Turn on **Track classes** and/or **Track locations**.
3. For locations, set the label to *Location* (the API calls these
   `Department`, whatever label the UI shows).
4. Create two or more locations, then tag some transactions with them.

Without one of these, `/stores` correctly reports that no location or class
breakdown is available rather than inventing one.

## 3. Connect the company

1. Start the application and sign in.
2. **Settings → QuickBooks → Connect QuickBooks**.
3. Authorise on the Intuit consent screen.
4. You are returned to the connection page with the company name, realm id,
   environment and token status filled in.

### What happens during the flow

```
GET  /api/quickbooks/connect
       creates a single-use `state` (SHA-256 stored, 15-minute expiry)
       redirects to https://appcenter.intuit.com/connect/oauth2
GET  /api/quickbooks/callback?code=…&state=…&realmId=…
       validates and consumes `state` (replay is rejected and audited)
       exchanges the code for tokens over HTTPS with Basic auth
       encrypts both tokens (AES-256-GCM) and stores them
       fetches CompanyInfo and records the company name and fiscal year
```

An invalid, expired or already-used `state` is refused and written to the audit
log as `quickbooks.oauth_state_invalid`.

## 4. Import history

**Settings → QuickBooks → Import historical data.** Choose 12, 24 (default),
36 months, or a custom count up to 36.

Each month pulls:

| Report / entity | Purpose |
|---|---|
| `ProfitAndLoss` | Income statement, per-account detail |
| `ProfitAndLoss` summarised by `Departments` or `Classes` | Store-level results |
| `BalanceSheet` | Cash, A/R, inventory, A/P, debt, equity |
| `CashFlow` | Operating / investing / financing split, when the company supports it |
| `AgedReceivables` | A/R aging buckets and customer detail |
| `AgedPayables` | A/P aging buckets and vendor detail |
| `Purchase`, `Bill`, `BillPayment`, `JournalEntry`, `Invoice`, `CreditMemo`, `RefundReceipt`, `SalesReceipt`, `Deposit`, `VendorCredit` | Vendor spend, drill-down, transaction review |

Master data is pulled once per sync: `Account`, `Vendor`, `Customer`, `Item`,
`Class`, `Department`, `CompanyInfo`.

A month that fails does not abandon the rest of the import. The job finishes as
`partial` and the connection page lists exactly which months and which reports
failed, with a retry.

### Reports that may be unavailable

Not every QuickBooks company can produce every report. When one is missing the
application records a warning and omits that section rather than estimating it:

- **Statement of Cash Flows** — some companies and some periods return nothing.
  The Cash section then shows only the verified beginning balance, ending
  balance and net movement, and says explicitly that the
  operating/investing/financing split was not estimated.
- **Location or Class P&L** — unavailable if the company does not track a
  dimension. Store pages say so.
- **Aging summaries** — unavailable on some cash-basis companies.

## 5. Token lifecycle

| Token | Lifetime | Handling |
|---|---|---|
| Access token | ~1 hour | Refreshed automatically when under 5 minutes remain, and once more on any `401` |
| Refresh token | ~100 days, rotated on each refresh | Stored encrypted; the new value replaces the old on every refresh |

If the refresh token expires or is revoked, the connection is marked `error`,
the failure is audited, and the UI prompts for a reconnect. Disconnecting
revokes the refresh token with Intuit and then deletes it locally; stored
history is kept so past reports remain readable.

## 6. Rate limits

Intuit throttles per realm. The client:

- honours `Retry-After` on `429`;
- otherwise backs off exponentially with full jitter, up to 5 attempts;
- retries `5xx` and network failures the same way;
- surfaces `QBO_RATE_LIMITED` if it still cannot proceed, so the sync job is
  marked retryable rather than failed-for-good.

## 7. Troubleshooting

| Symptom | Cause and fix |
|---|---|
| `invalid_redirect_uri` on the consent screen | `INTUIT_REDIRECT_URI` does not exactly match a URI on the Intuit app |
| "The QuickBooks authorisation link has expired or was already used" | The `state` was consumed or is older than 15 minutes — start the connection again |
| "The QuickBooks authorization has expired or been revoked" | The refresh token is dead. Reconnect from Settings → QuickBooks |
| Reports import but store pages are empty | The company does not track Locations or Classes, or transactions are untagged |
| Sync completes as `partial` | Expand the warnings on the connection page; each names the month and report |
| Everything is unmapped | Approve the suggested mappings in Settings → Account Mappings |
