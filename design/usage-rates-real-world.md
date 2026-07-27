# Usage rates against real-world venues

A stock period is arithmetic over four inputs — opening count, deliveries,
wastage, closing count — and every one of them is captured by a busy person
doing something else. This is a review of where that arithmetic meets an
actual pub, and what breaks.

Written after the section-pairing bug was found by accident, which is a poor
way to find the rest.

Last reviewed: July 2026.

---

## Fixed

### Periods paired across sections
Stock takes are created per section — the stock screen has separate bar and
kitchen buttons — so a venue counting both produces an interleaved run.
`usagePeriods` paired them in date order, putting a bar take opposite a kitchen
one. They share no items, `computePeriodUsage` needs an item at both ends, so
**every period came back empty**. A venue counting both halves of its stock got
no usage rates at all and nothing said why. Now grouped by section first.

### Deliveries dated when typed, not when they arrived
`receivedAt` was the moment the entry was keyed in. Nobody scans a note while
the drayman is still in the cellar, and every period is windowed on that field,
so a delivery entered after a count landed on the wrong side of it.

Measured against a pub taking 3 kegs weekly and counting fortnightly:

| scan lag | measured | error |
|---|---|---|
| 0–3 days | 3 kegs/wk | correct |
| 5–7 days | 2.25 kegs/wk | −25% |

It only bites when a delivery crosses a count boundary, but then it bites hard,
and **usage is the milder half**. The same window drives the variance report,
where a delivery on the wrong side of a count manufactures a phantom three-keg
shortfall — that isn't a bad forecast, it's an accusation.

Deliveries now carry the note's own delivery date, with `loggedAt` kept
separately for the audit trail, and a future date is refused so a misread year
can't park stock beyond every boundary. The review screen says which date the
stock will move on.

---

## Known and unfixed

### Manual delivery entry still stamps "now"
The scan path reads the date off the document. Hand-entered deliveries have no
document to read, so a manager catching up on Monday for Thursday's drop
reintroduces exactly the bug above. Needs a date field on the manual entry
form — small, and worth doing before any venue leans on par levels.

### Reopening a completed take moves a period boundary
`reopenStockSession` sets `completedAt: null`; re-completing stamps a new one.
Reopen last month's count, close it again today, and every delivery in between
silently changes period. While it's open the take is excluded from
`usagePeriods` altogether, merging two periods into one. Both behaviours are
arguably correct and neither is visible. Preserving the original `completedAt`
across a reopen would be the honest fix.

### A base-unit change corrupts a period silently
Quantities are stored in base units, so a keg going from 50L to 30L is safe —
both are litres. What isn't safe is changing the *base*: a spirit re-modelled
from `Bottle 1*70cl` + tenths to `Case 1*6Each` + each leaves the opening count
in tenths and the closing count in each. The subtraction still runs and the
answer is meaningless. Worth refusing a unit change on an item with counts in
an open period, or stamping the base unit onto each count so a mismatch can be
detected.

### Closures and seasonality dilute the rate
A fortnight shut reads as a fortnight of low trade. Usage per week is per
*calendar* week, with no notion of trading days. A seasonal venue's winter rate
will under-order for spring. Trading-day awareness is a real feature, not a
tweak — but the spread across periods already flags such venues as low
confidence, which is the honest interim answer.

### Multi-venue transfers look like consumption
Stock moved between two venues on the same account is neither a delivery nor
wastage. It reads as usage at the source and as a negative-usage miscount at
the destination, where it's silently discarded as implausible. Only affects
multi-site accounts, and only those that move stock.

### A count takes hours; `completedAt` is an instant
Deliveries arriving mid-count land on whichever side of the closing instant
they happen to fall. The error is at most one delivery and only on count day.
Noted for completeness; not worth solving.

---

## Things that turned out to be fine

- **Items added mid-period** are absent from the opening count and correctly
  excluded rather than counted as pure consumption.
- **Two counts on the same day** (a recount) are guarded by the `days > 0.5`
  floor rather than dividing by something near zero.
- **Partial counts** — a weekly cellar check of draught only — work as
  intended: items counted at both ends produce a period, the rest don't.
- **Keg size changes** are safe, because the base unit stays litres.
- **Renames** are safe; periods key on item id.
- **Unlogged deliveries** surface as negative usage and are excluded as
  implausible rather than dragging a rate below zero.
