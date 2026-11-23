# POSNIC old-to-V2 accounting schema map

**Inspection only — no database migration has been executed.**

## Source and target revisions

| System | Branch | Inspected commit |
|---|---|---|
| Original POSNIC | feat/article-cost-label-designer-sales-calendar | c56e3a72485080d1d1aa43656f56373eb579f0e4 |
| Rebranded POSNIC V2 | feat/posnic-v2-rebrand | 914dcb13bf0977b91cfb5a63be5091bf1c00db7d |

The repository is a shared codebase with the legacy frontend and the V2 frontend on separate branches. Core backend model files inspected for sales, items, customers, expenses, receivings, registers, stock logs and shifts are substantially shared. The V2 Sale model adds sale_original_snapshot and sale_original_total; preserve them when present and never fabricate them for old invoices.

A Git branch is not a database. The actual source and destination MongoDB database names, URIs, license IDs, branch IDs and contents have not been supplied. Therefore no records have been copied, updated, reconciled or deleted.

## Record map

| Business record | Current collection / source | Important fields and links | Accounting interpretation |
|---|---|---|---|
| Sales / invoices | sales | _id, sales_id, branch_id, license, date, created_date, sale_process, sales_total, sales_sub_total, items_total, discount, extra_discount, cashregister_id, user_id, customer_id | Saved sales_total is the payable total after discounts/rounding. Do not recompute from today's catalogue prices or payment receipts. |
| Sale lines / cost snapshot | Embedded sales.items[] | item, name, quantity, unit_price, discount, total, total_amount, company_price_total, item_id, item_unit, modifiers | company_price_total is the sale-line historical cost snapshot when present. Current items.company_price is not a valid historical fallback. Missing snapshots must be flagged unavailable. |
| Sale payments | Embedded sales.payments[]; legacy multi_payment / payment_mode | payment amount, date, method, collection_status, collected_at, origin; sale paid_amount, payment_pending, partial_check, partial_balance, payment_status | Use event dates and payment origins. Credit-settlement payments appended to a sale are not a second sale-day tender. Legacy split-payment shapes require normalization. |
| Customer debt ledger | transaction | customer_id, sale_id, sale_total, pending, created_date, updated_date, last_payment_date, branch_id, license | CreditService defines current due as sum of ledger pending. This mutable balance alone cannot reconstruct an arbitrary historical day without dated collection events. |
| Credit collections | credit_payments | customer_id, amount, method, allocations[] (transaction/sale IDs and amounts), branch_id, license, received_at, register_id | Collection event date is received_at. Cash collections are also journaled into cashregister.cashInOutDetail with source credit_settlement; count the event once, not both copies. |
| F6 Versements | sale_versements plus sales.versement_checkout | sale_key, sale_object_id, branch_id, initial_amount, initial_method, initial_collected_at, initial_recorded_amount, remaining, status, settlement.amount/method/settled_at, settled_at, history[] | Initial deposit and final settlement are separate dated events. A settlement-day report must not count the original deposit again. Pending F6 invoices are excluded from ordinary reportable-sale aggregates until settled. |
| TPE / BaridiMob settlement batches | payment_settlements | request_id, request_hash, collected_at, recorded_at, lines[] with sale_key, method, amount, sale_amount | Separate settlement journal for TPE/BaridiMob. Current writer does not add explicit branch_id or license to each batch; database/tenant isolation matters, and cross-branch attribution must not be guessed. |
| Sale modifications | sale_edit_adjustments and sales.changes[] / sale_original_snapshot | adjustment amount, created_at, branch_id, license; sale snapshots where available | Modification deltas are dated adjustments. Preserve original invoice values and do not rewrite them to force report totals. |
| Returns / refunds | Embedded sales.items_return[] and return_refund_transactions[] | returnArray.returnDate, returnObjId, itemsTotalAmount, cashregister_id; refund created_at/return_date, amount, refund_method | Merchandise return value and actual refund payment are distinct facts. Refund cash outflow uses actual refund event and method. COGS reversal requires proof of returned quantity, usable stock restoration and historical cost snapshot. |
| Expenses | expenses | amount, type, category, date, created_date, branch_id, license, optional legacy payment_source | Model does not declare a reliable payment-method field. Inspect real documents before deciding cash vs non-cash; never classify unknown methods as cash without evidence. |
| Employee records | hr_workers | _id, name, monthly_salary, hourly_rate, start_date, license | Current HR writer is license-scoped and does not persist a branch on the worker. |
| Salary / advances / bonuses | hr_transactions | worker_id, worker_name, type, amount, date, period, method, license, cancelled_at, is_cancelled | Types include salary_payment, advance, overtime, prime_weekly, prime_monthly, adjustment. Current writer is license-scoped and does not persist branch_id; branch attribution is unresolved unless source records or an explicit mapping establish it. |
| Cash register sessions | cashregister | branch_id, license, register_id, register_status, opening_float, register_opendate, register_closedate, register_sales[], cashInOutDetail[], cashDenomDetail[], countedAmount[], closing_expected, closing_counted, over_short | Opening float and cash-in/out journal are source facts. Journal copies of credit collections and other source-linked entries must be deduplicated against canonical event collections. |
| ZR delivery payouts | zr_delivery_payouts | branch_id, license, paid_at, amount | Payout becomes a cash movement only at its actual payout event, not when the original sale was created. |
| Items / variants / inventory | items, variants, inventory, stocklogs | item _id, branch_id, quantity, available_quantity, current company_price/cost_price; stock log item, quantity, process, date, opening/closing balance | Current stock and cost are not historical sale cost. Use sale-line cost snapshots for COGS and stock movement records only to reconcile inventory. |
| Purchases / supplier bills | receivings | receiving_id, supplier, items[].item/quantity/cost_price/total, subtotal, tax, discount, total, payment_status, payment_method, timestamps, branch/license context | Purchase line cost is historical purchase evidence, not a substitute for a missing sale-time cost snapshot unless a deterministic dated lot/cost allocation is proven. |
| Customers / suppliers / branches / users | customers, suppliers, branches, users | ObjectId references, branch_id, branch_access, license, branch time_zone | Preserve IDs and references. Never copy users/credentials over a target admin account without a separate identity plan. |

## Existing daily-report findings

The current daily endpoint is GET /api/sales/dailySalesReports in api/src/controllers/sales.controller.js. It already uses dailyReportPeriod() for branch-timezone half-open date windows and reportableSales() for posted-sale eligibility.

The current implementation is not yet the requested unified accounting engine. Source inspection found these material gaps:

1. outstanding_amount sums payment_pending only from sales in the selected report period; it is not the complete receivables balance as of the end of that day.
2. Settled Versement reporting selects documents by settled_at and then adds both the initial deposit and final settlement. This can move the original deposit into the settlement day and count it twice.
3. versementCashTotal repeats that same initial-plus-settlement issue.
4. The cashier-only cash_expected path excludes credit collections and Versement payments, omits opening float, subtracts all report expenses rather than only proven cash outflows, and does not reconcile all cash-register movements.
5. Expense records do not have a declared canonical tender field in the current model; method classification must be based on verified stored records.
6. HR transactions are currently license-scoped without a branch identifier. A multi-branch allocation cannot safely be inferred from the current writer.
7. Return value and refund cash movement are stored separately; stock restoration and COGS reversal need explicit proof.

These are the first accounting-engine correction targets. They must be addressed centrally so the closing ticket, daily report, dashboard summaries and historical reports cannot drift into separate formulas.

## Migration gates — do not bypass

- Obtain both source and target database backups or read-only connection details, their database names, and the exact license/branch scope.
- Confirm whether the two app installations use the same MongoDB database. If they do, a bulk copy is not appropriate; reconcile in place instead.
- Inventory and count all source collections before writing to the target.
- Compare IDs, branch/license references and collection indexes. The same collection name is not proof of identical transaction meaning.
- Resolve license-only HR and payment-settlement records before branch-level allocation. Unresolved records stay in the reconciliation report; they are not assigned to a guessed branch.
- Preserve original _id values wherever possible. Existing target _id conflicts must be reported and never overwritten automatically.
- Make the migration dry-run first, then use idempotent insert-only batches with checkpoints and a rollback manifest.
- Reconcile counts and sums by category and branch before acceptance. Keep the source backup unchanged.

**Migration status:** blocked pending source/target database access and scope confirmation. No historical records have been migrated or modified by this work.
