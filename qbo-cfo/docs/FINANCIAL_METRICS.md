# Financial Metrics

Every formula the application uses. All of it is implemented in
`src/lib/finance/` and covered by tests in `tests/math.test.ts`,
`tests/metrics.test.ts` and `tests/locations.test.ts`.

---

## The two rules that govern everything

**1. Never divide by zero.** Every ratio helper returns `null` rather than
`Infinity` or `NaN` when the denominator is zero or missing.

**2. `null` renders as `N/M`, never as a number.** "Not meaningful" is shown to
the owner as `N/M`. A comparison against a zero or absent prior period is never
displayed as `0%`, `100%`, or `—%`.

```ts
safeDivide(100, 0)     // null   → "N/M"
pctChange(100, 0)      // null   → "N/M"
pctChange(100, null)   // null   → "N/M"
```

---

## Percentage change

```
(current − previous) / ABS(previous)
```

`ABS` on the denominator keeps the sign meaningful when the prior period was
negative. A loss improving from −$10,000 to −$5,000 is **+50%**, not −50%.

| current | previous | result |
|---|---|---|
| 110 | 100 | +10.0% |
| 90 | 100 | −10.0% |
| −5,000 | −10,000 | +50.0% |
| −15,000 | −10,000 | −50.0% |
| 100 | 0 | `N/M` |
| 100 | missing | `N/M` |

## Percentage-point change

Ratios (margins, expense ratios) never use percentage change — a margin moving
from 44.7% to 43.6% is reported as **−1.1 pts**, not as −2.5%.

```
points = current_ratio − previous_ratio
```

Its dollar consequence is reported alongside it:

```
margin impact = current_revenue × (current_margin − previous_margin)
```

> "Gross margin declined from 45.2% to 42.8%, reducing gross profit by
> approximately $18,400 compared with maintaining last month's margin."

---

## Income statement

```
Net Sales      = Gross Sales − Discounts − Returns
Gross Profit   = Net Sales − COGS
Gross Margin   = Gross Profit / Net Sales
Operating Inc. = Gross Profit − Operating Expenses
Net Income     = Operating Income + Other Income − Other Expense
Net Margin     = Net Income / Net Sales
```

**Contra revenue.** QuickBooks reports discounts and returns as negative
income lines. The engine stores them positive: a −$20,000 discount line becomes
`discounts = 20,000`, so `Net Sales = Gross Sales − Discounts − Returns` holds.

**QuickBooks subtotals win.** Total income, total COGS, gross profit, total
expenses and net income are taken from QuickBooks' own summary rows where
present, and only computed from classified lines as a fallback. The difference
between the engine's category-derived net sales and QuickBooks' Total Income is
retained as `netSalesVariance` and surfaced as a data-quality signal rather than
being silently absorbed.

**Unmapped expenses.** An expense line whose account has no approved mapping is
*not* forced into "Other". It accumulates into `unmappedOpexAmount` and
`unmappedOpexPct`, which drive the warning "12.8% of operating expenses are
currently unmapped." It still counts toward total operating expenses, because
QuickBooks says so — only its attribution is unknown.

---

## Balance sheet

Classified by QuickBooks `AccountType`, never by account name:

| Line | Source |
|---|---|
| Cash | `Bank` |
| Accounts Receivable | `Accounts Receivable` |
| Inventory | `Other Current Asset` with sub-type `Inventory` |
| Other Current Assets | `Other Current Asset` less inventory |
| Total Current Assets | Bank + A/R + Other Current Asset |
| Fixed Assets | `Fixed Asset` |
| Total Assets | Current + Fixed + `Other Asset` |
| Accounts Payable | `Accounts Payable` |
| Credit Cards | `Credit Card` |
| Short-Term Debt | `Other Current Liability` with a loan/line-of-credit sub-type |
| Total Current Liabilities | A/P + Credit Card + Other Current Liability |
| Long-Term Debt | `Long Term Liability` |
| Total Liabilities | Current + Long-term |
| Equity | `Equity` |

**Balance check.** `|Total Assets − (Total Liabilities + Equity)| < $1`. A
QuickBooks balance sheet always balances, so a mismatch means our copy is
incomplete. It is reported as a failing data-quality check, never hidden.

---

## KPI definitions

| KPI | Formula |
|---|---|
| Revenue growth MoM | `pctChange(net_sales, prior_month_net_sales)` |
| Revenue growth YoY | `pctChange(net_sales, same_month_last_year_net_sales)` |
| Gross margin | `gross_profit / net_sales` |
| Net margin | `net_income / net_sales` |
| Operating expense ratio | `operating_expenses / net_sales` |
| Payroll % of revenue | `payroll / net_sales` |
| Advertising % of revenue | `advertising / net_sales` |
| Rent % of revenue | `rent / net_sales` |
| Delivery % of revenue | `delivery / net_sales` |
| Merchant fees % of revenue | `merchant_fees / net_sales` |
| A/R as % of revenue | `accounts_receivable / net_sales` |
| A/P as % of revenue | `accounts_payable / net_sales` |
| Working capital | `current_assets − current_liabilities` |
| Current ratio | `current_assets / current_liabilities` |
| Quick ratio | `(current_assets − inventory) / current_liabilities` |
| Days sales outstanding | `(accounts_receivable / net_sales) × 30` |
| Days payable outstanding | `(accounts_payable / cogs) × 30` |
| Days inventory outstanding | `(inventory / cogs) × 30` |
| Cash conversion cycle | `DSO + DIO − DPO` |
| Average monthly revenue | mean of trailing 12 months |
| Trailing 3 / 6 / 12 revenue | sum of the trailing N months |
| Rolling gross margin | `sum(T12 gross profit) / sum(T12 revenue)` |
| Rolling net margin | `sum(T12 net income) / sum(T12 revenue)` |

Working-capital day counts use a 30-day month so figures are comparable across
months of different lengths.

---

## Comparison windows

| Window | Definition |
|---|---|
| Prior month | The calendar month before the reporting month |
| Same month last year | The same calendar month, one year earlier |
| Year to date | Fiscal-year start through the reporting month end |
| Prior year to date | The same window shifted back one year |
| Trailing 12 months | The reporting month and the 11 before it |

Year-to-date honours a non-calendar fiscal year. With a July fiscal start,
February 2026 belongs to the year that began July 2025, so YTD runs
2025-07-01 → 2026-02-28 and prior YTD runs 2024-07-01 → 2025-02-28.

**Aggregation rule.** When months are combined, flows (revenue, expenses,
income) are summed and margins are **recomputed on the aggregate** — never
averaged. Balance-sheet values are point-in-time, so the closing month's values
carry through.

---

## Store contribution

Per-store results come from a P&L summarised by the QuickBooks Location
(`Departments`) or Class dimension. Each column is parsed as its own complete
P&L, so store revenue and expenses come from QuickBooks' own arithmetic.

```
Store Gross Profit  = Store Net Sales − Store COGS
Store Contribution  = Store Gross Profit − Store Operating Expenses
Contribution Margin = Store Contribution / Store Net Sales
```

**Shared corporate overhead is not allocated to stores.** Contribution is
therefore not store net profit, and every place it appears — screen, PDF, Excel,
chat — is labelled **Store Contribution Before Corporate Overhead**. The
`overhead_allocated` flag on each row is `false`, and the AI context repeats the
caveat so the model cannot describe a store as independently profitable.

Stores are ranked by contribution margin, then by revenue.

---

## Cash

```
Beginning Cash = prior month ending cash
Ending Cash    = reporting month cash
Net Change     = Ending − Beginning
```

The operating / investing / financing split is shown **only** when QuickBooks
returned a Statement of Cash Flows for the period. When it did not, those three
lines stay `null` and the report says so:

> "QuickBooks did not return a Statement of Cash Flows for this period, so only
> the verified beginning and ending cash balances are shown. The operating,
> investing and financing split is not estimated."

When cash falls while net income is positive, the report names the balance-sheet
movements that could absorb it (inventory, receivables, debt repayment, owner
distributions) as possibilities to investigate — not as a determined cause.

---

## Materiality

Two configurable thresholds per company (defaults **$1,000** and **10%**).

An expense change is flagged material when it clears **both**:

```
|change| ≥ materiality_amount   AND   |change %| ≥ materiality_pct
```

Requiring both prevents two classes of noise: a large percentage on a trivial
amount, and a large amount that is trivial relative to its base.

Some findings are surfaced on strategic importance regardless of size — a new
vendor, a suspense balance, a duplicate-looking payment — because their value is
the signal, not the amount.

---

## Anomaly thresholds

Deterministic rules, all configurable in *Settings → Alerts*.

| Rule | Default |
|---|---|
| Revenue change MoM | > 10% |
| Revenue change YoY | > 15% |
| Gross margin shift | > 2 points |
| Expense category spike | > 20% **and** > $2,000 |
| Expense vs trailing average | > 120% of the 6-month average and > $1,000 above it |
| Payroll % of revenue | up > 2 points |
| Advertising up while sales flat or down | ad spend +5% with revenue ≤ 0% |
| Cash decline | > 15% and > $5,000 |
| A/R over 90 days growing | > 20% and > $2,500 |
| A/P over 90 days growing | > 20% and > $2,500 |
| Bank fee spike | > 1.5× trailing average and > $250 above it |
| Financing fee spike | > 1.4× trailing average and > $1,000 above it |
| Merchant processing rate | ± 0.3 points of revenue |
| Large new vendor | first-month spend > $5,000 |
| Vendor spend jump | > 50% and > $5,000 |
| Large single transaction | > $25,000 **and** above the type's historical pattern |
| Duplicate-looking transactions | same payee and amount, ≥ $1,000 |
| Uncategorised / suspense balance | > $1,000 |
| Unmapped operating expenses | > 5% of operating expenses |

The large-transaction rule deliberately requires both conditions: a $38,000
inventory bill is routine for a furniture retailer and is compared against the
90th percentile of that transaction type over the past twelve months before
being flagged.

**Severity** rises with how far past the threshold a value sits and with its
dollar impact: `INFO` → `WATCH` → `IMPORTANT` → `CRITICAL`. Findings are ranked
by a score combining severity, dollar impact and impact relative to revenue, so
the biggest problems appear first in "Needs Your Attention".

---

## Report confidence

`High` / `Medium` / `Low`, derived from the close checks:

- any failing check → **Low**
- one or more warnings → **Medium**
- everything passing → **High**

Failing checks include a missing P&L, an unbalanced balance sheet, unmapped
expenses above 10%, and missing location data when store reporting was
requested. Warnings include an incomplete month, a company-name mismatch,
material suspense balances, negative inventory and aged receivables or payables.

Confidence describes the **cleanliness of the bookkeeping**, not the accuracy of
the arithmetic.
