# Financial Reconciliation

**Company:** Harborline Furniture Co. (Demo)
**Period:** July 2026 (2026-07-01 to 2026-07-31)
**Basis:** Accrual
**Source:** Demo data (synthetic)
**Generated:** 2026-08-23T04:29:47.539Z
**Profit & Loss snapshot:** `ef0f3596-917c-420b-accc-6ee3d38669f6`
**Balance Sheet snapshot:** `2cb2bf45-fb29-4310-b9a4-6807aa02fa58`

QuickBooks values are read directly from the stored raw report JSON — QuickBooks' own
subtotal rows — not through the application's classification logic, so agreement is a
genuine check rather than a restatement.

| Metric | App Value | QuickBooks Value | Difference | Status |
|---|---:|---:|---:|---|
| Total Income | $681,369.54 | $681,369.54 | $0.00 | MATCH |
| Net Revenue | $681,369.54 | $681,369.54 | $0.00 | MATCH |
| COGS | $374,548.84 | $374,548.84 | $0.00 | MATCH |
| Gross Profit | $306,820.70 | $306,820.70 | $0.00 | MATCH |
| Total Operating Expenses | $280,028.06 | $280,028.06 | $0.00 | MATCH |
| Operating Income | $26,792.64 | $26,792.64 | $0.00 | MATCH |
| Net Income | $17,079.05 | $17,079.05 | $0.00 | MATCH |
| Gross Margin | 45.0300% | 45.0300% | 0.000000 pts | MATCH |
| Cash | $557,554.98 | $557,554.98 | $0.00 | MATCH |
| Accounts Receivable | $202,147.55 | $202,147.55 | $0.00 | MATCH |
| Accounts Payable | $411,197.24 | $411,197.24 | $0.00 | MATCH |
| Inventory | $1,698,672.02 | $1,698,672.02 | $0.00 | MATCH |
| Current Assets | $2,500,374.55 | $2,500,374.55 | $0.00 | MATCH |
| Total Assets | $2,928,174.55 | $2,928,174.55 | $0.00 | MATCH |
| Current Liabilities | $1,600,603.93 | $1,600,603.93 | $0.00 | MATCH |
| Total Liabilities | $1,663,403.93 | $1,663,403.93 | $0.00 | MATCH |
| Equity | $1,264,770.62 | $1,264,770.62 | $0.00 | MATCH |
| Assets = Liabilities + Equity | $2,928,174.55 | $2,928,174.55 | $0.00 | MATCH |

**Matched:** 18 · **Differing:** 0 · **Unavailable:** 0

**Result: PASS.** Every available total ties to QuickBooks to the cent.

- **Total Income:** The application reports Net Revenue (gross sales less discounts and returns). QuickBooks Total Income is the same figure: contra-revenue accounts are negative income lines inside that subtotal.
- **Gross Margin:** QuickBooks does not print a gross margin percentage; this is gross profit divided by total income from the same report.
- **Assets = Liabilities + Equity:** The accounting identity, checked directly against the stored QuickBooks Balance Sheet.
