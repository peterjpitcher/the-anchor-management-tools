# W3. What an amendment does to a seasonal deposit

Date: 2026-08-03
Status: **decided on the standing recommendation, pending owner confirmation.** No code changed.

## The decision

**Shrinking a party stays a manual correction for the first season.** Today, changing the party
size on a booking carrying a `booking_period_id` refuses and warns rather than re-pricing, money
already taken stays taken, and staff correct it by hand. That behaviour is unchanged.

## Why this way

Automatic refunds on amendment is a money path with no operational history behind it. Nobody has
yet watched a single seasonal booking be amended in anger, so there is no evidence about how often
it happens, who does it, or what staff expect to see afterwards. Writing a refund rule now would be
guessing at all three, and a wrong guess moves real money.

The current behaviour also fails in the safer direction. A refusal plus a warning makes the
over-collection **visible**: somebody has to look at it and decide. Silent auto-refunding would make
the same situation invisible, and an incorrect automatic refund is materially harder to notice than
an incorrect manual one, because nothing prompts anyone to check.

There is also a real technical obstacle, and it is the reason the refusal exists rather than an
oversight. When the groups-of-ten rule beats the seasonal one, the booking's snapshot records the
**group** basis and rate, so the period's rate is simply not there to re-apply. Reading it back off
`booking_periods` instead would price the guest against terms a manager may have edited since the
booking was taken, which is a worse failure than not re-pricing at all.

## What this costs

Staff carry the correction by hand for one season. That is a known, bounded cost, paid by the people
best placed to notice when it is wrong.

## When to revisit

After the first full season, with the amendment rate in hand. If seasonal amendments turn out to be
common, the right build is a re-pricing path that reads the booking's own snapshot rather than the
live period row, so an amendment is priced against the terms the guest actually accepted.

## Owner confirmation

This proceeds on the recommendation unless the owner says otherwise. The alternative, automatic
refunds on shrink, is a bigger build and a live money path; say so and it gets specced properly
rather than bolted on.
