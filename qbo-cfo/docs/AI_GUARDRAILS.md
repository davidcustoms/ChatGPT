# AI Guardrails

The rule this system is built around:

> **The application does the maths. The model explains it.**

No number shown to an owner is produced by a language model. Every figure is
computed deterministically from stored QuickBooks data, and the model's output
is filtered against those figures before it is displayed.

---

## Database-first, always

Sending an accounting question straight to a model and hoping it works out the
answer is not permitted anywhere in this codebase. Both AI surfaces follow the
same shape:

```
question or report request
  → the application queries and calculates
  → verified JSON / labelled metric context
  → the model writes prose about those values
  → post-processing verifies every amount it quoted
  → display, with the period and source attached
```

If the application cannot compute an answer, the pipeline says so. It never
falls through to the model.

---

## Where AI is used

| Surface | What the model does | What it never does |
|---|---|---|
| Monthly report commentary | Explains what changed and why it matters; proposes actions | Compute or estimate any figure |
| "Ask Your CFO" | Rewords an already-correct answer conversationally | Answer from memory, or change a number |

Both are optional. Without `OPENAI_API_KEY` the product remains fully
functional: reports use application-written commentary derived from the anomaly
engine, and chat returns the deterministic answer verbatim.

---

## The context the model receives

`src/lib/ai/context.ts` builds a clean, labelled metric set — never a raw
bookkeeping dump. It contains:

- the company, reporting period, data-through date and source system;
- the report confidence and any data-quality notes;
- current month, prior month, same month last year and year-to-date figures;
- key ratios;
- the top expense categories with prior, change, share of revenue and T12
  average;
- cash position, aging totals, top vendors, store results;
- the deterministic alerts the anomaly engine already produced;
- the application's own written observations.

While building that text it also collects an **allow-list of every literal
figure** it wrote. That set is what the output is checked against.

Where a figure genuinely does not exist, the context says so explicitly. For
example, when QuickBooks returned no Statement of Cash Flows:

```
Cash flow statement available: no
Do NOT state operating, investing or financing cash flow figures; they were not provided.
```

---

## The system prompt

Verbatim, from `src/lib/ai/prompts.ts`:

> You are an experienced CFO analysing verified financial data from QuickBooks
> Online for the owner of a multi-location retail business.
>
> You must use only the financial data supplied to you in this message.
> Never invent revenue, expenses, margins, cash balances, store results, vendor
> amounts, or accounting facts. Every number you state must appear verbatim in
> the supplied data.
>
> Clearly distinguish between:
> 1. verified facts (figures present in the supplied data),
> 2. calculated conclusions (arithmetic on those figures),
> 3. hypotheses requiring investigation (possible explanations you cannot verify
>    from the data).
>
> Prioritise material business issues over minor variances.
> Use exact amounts and percentages when supplied.
> Explain why a change matters to the business, in dollars where possible.
> Avoid generic recommendations such as "reduce costs" or "improve margin";
> recommend a specific, checkable action.
> Do not treat correlation as causation — if two things moved together, say so
> and propose how to test the link.
> Do not give definitive tax, audit, or legal advice, and never present your
> analysis as a substitute for CPA review.
> If the data is insufficient to answer, say so plainly.
> Where a conclusion depends on data you were not given, begin the sentence with
> "Based on the QuickBooks data available...".
>
> Your audience is the business owner, not an accountant. Write clearly,
> concisely and practically.

---

## Structured output

The model must return JSON matching a strict schema. Every insight carries:

| Field | Purpose |
|---|---|
| `category` | Business area — "Advertising Efficiency", "Gross Margin", "Cash" |
| `severity` | `INFO` / `WATCH` / `IMPORTANT` / `CRITICAL` |
| `observation` | What changed, in supplied figures |
| `supporting_metrics` | The metrics behind it, quoted exactly |
| `likely_implication` | Why it matters, in dollars where possible |
| `recommended_action` | One specific, checkable action |
| `confidence` | `low` / `medium` / `high` |

Requiring `supporting_metrics` on every insight forces the model to point at the
data rather than assert.

---

## Enforcement, not instruction

Prompt instructions are necessary but not sufficient. Two mechanical checks run
on every response.

### 1. Figure verification

`extractFigures()` pulls every dollar amount, percentage and point movement out
of the model's text. Each **dollar amount** is normalised and checked against
the allow-list built with the context. An insight quoting an amount that was
never supplied is **dropped entirely** — not edited, not footnoted.

Percentages are allowed to be derived, because a ratio of two supplied dollar
amounts is legitimate arithmetic on verified inputs.

The same check runs on the executive summary. If it fails, the summary is
replaced with the application's own deterministic summary.

Dropped insights are logged with a count, so a model that starts inventing
figures is visible in operations rather than silent.

### 2. Graceful degradation

`generateInsights()` never throws. A missing API key, a timeout, a rate limit,
a schema violation or an empty response all fall back to commentary generated
from the anomaly engine, and the report still completes. The reason is returned
as a warning and shown to the owner.

---

## What the model is structurally prevented from doing

| Risk | Control |
|---|---|
| Changing accounting records | The QuickBooks client is `GET`-only and rejects mutating endpoints; no AI code path touches Intuit at all |
| Claiming missing numbers exist | Context states what is unavailable; unverified amounts drop the insight |
| Inventing cash balances | The cash-flow split is omitted, and its omission is stated, when QuickBooks did not return it |
| Inventing store profitability | Store figures are labelled *Store Contribution Before Corporate Overhead*, and the context repeats that overhead is unallocated |
| Treating correlation as causation | Instructed against; the deterministic layer supplies the co-movement, the model proposes how to test it |
| Definitive tax or legal advice | Instructed against; every report closes with the CPA disclaimer |
| Guessing account classifications | Classification happens before the model runs, from QuickBooks account types and owner-approved mappings |
| Answering numerics from memory | Chat receives a pre-computed JSON result and is told to reword, not compute |

---

## Ask Your CFO

The chat pipeline is deterministic end to end:

1. **Classify** the question with rule-based intent detection — no model call,
   fully testable.
2. **Extract** the period, category, vendor, store and limit mentioned.
3. **Resolve** those hints against periods that actually have stored data. A
   month with no data returns "I do not have stored data for…", never an
   invented figure.
4. **Query** the database and compute the answer, producing both a verified JSON
   result and a complete written answer.
5. **Narrate** — the model rewords step 4. If it is unavailable, step 4's text
   is shown as-is.
6. **Attribute** — every answer displays `Data through: <date>` and
   `Source: QuickBooks Online`, and the verified JSON is viewable in the UI.

Fifteen supported question shapes are covered, including profit bridges, store
comparisons, vendor lookups, margin trends, cash movement and aging. An
unrecognised question says so and suggests what can be asked.

---

## Reporting language

The report is written to sound like a CFO, which means quantified and
consequential rather than vague.

Good:

> "Gross margin declined from 45.2% to 42.8%, reducing gross profit by
> approximately $18,400 compared with maintaining last month's margin."

Bad:

> "Gross margin went down. Consider improving it."

The deterministic observation builder already writes in this register, which
both sets the standard for the model and provides the fallback when it is
unavailable.

---

## Tests

`tests/ai-guardrails.test.ts` covers figure extraction, the hallucination
filter (including that it inspects supporting metrics and implications, not just
the observation), the context's allow-list, the cash-flow prohibition, the
schema's required fields and the deterministic fallback.
