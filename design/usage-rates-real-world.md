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

Manual entry has an arrival-date field too, defaulting to today — which is
right nearly always, since most deliveries are logged off the van. It only
speaks up when you change it, and then it says which period the stock will
land in.

### Reopening an older take moved a period boundary
`reopenStockSession` sets `completedAt: null`; re-completing stamps a new one.
Reopen last month's count, close it again today, and every delivery in between
silently changes period — a variance already reviewed and signed off quietly
becomes a different number.

Reopening is now offered only on the newest completed take in each section.
That's enough: amending the most recent count only ever affects the open-ended
period nobody has drawn conclusions from yet, and there's no legitimate reason
to reopen an earlier one. Per section, because a bar take and a kitchen take
each have their own "most recent".

A guard against corrupting history rather than a security control — the rules
already restrict reopening to managers, and a manager is trusted. Making it a
rule would mean denormalising "is this the latest" onto every session, which
is a worse trade than a UI guard on an already-trusted actor.

---

## Known and unfixed

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
