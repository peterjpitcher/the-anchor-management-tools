# Lessons Learned

<!-- After every correction from the owner, add a dated entry: the mistake, then the rule. -->
<!-- Read this file at the start of every session. Keep it under about 40 lines. -->
<!-- A lesson that has held for a month moves into CLAUDE.md or docs/standards/ and its entry is deleted. Last consolidation: 6 November 2026. -->

## 13 October 2026: digitising a paper process, keep every signature and every trigger

The owner's first live test of document signing ticked "Outside food" on a booking and got a contract with no food agreement. Two faults. First, the food agreement was triggered only by a catering package marked as needing one; the "Outside food" tick on the booking form, which says the same thing in the same words, was read by nothing (three live bookings had the tick and no agreement). Second, I had folded the food agreement into the contract's one signature, although the printed annex says in bold that its signature is separate from the contract's. The owner also had to point out that the signed copy still showed blank signature lines.

When a paper process goes online: list every input that can make a document necessary and route them all through one rule (here `src/lib/private-bookings/waiver-status.ts`); keep each separate signature block on the paper as a separate signature online; and open the finished signed copy and read it as the customer will, because a signed document with empty signature lines looks unsigned whatever the record page says. Before saying a feature covers "every aspect", walk each record's whole life (changed, cancelled, settled another way, signed on paper) and not only the send and sign path.

## 2026-11-02 Clear the writer, not just the row
- On 5 October a Barons invoice contact's block-list row was deleted by hand, and the note said any Resend email to her would put it back. A different app on the shared Resend account (BaronsHub) did exactly that the next Monday, and she missed two invoice emails before anyone noticed. When a bad row is cleared, find what wrote it and stop that in the same change, or say plainly that it will come back.

## 2026-11-02 A promised weekly send must not be held by another rule
- The weekly invoice chasers were switched on for Monday 2 November, but the "no reminder within 3 days of any other invoice email" rule held every one back, because both clients had a new invoice that morning. The owner wanted the Monday emails regardless and had the rule removed. When a feature promises a send on a set day, list every rule that can stop that send and confirm each one with the owner before switch-on.

## 2026-11-03 A refusal the app could resolve itself is a stall
- FF-41 (2 November) made the separation warn about leave after the last working day and left it to a person to clear. The next morning the nightly job refused the first leaver it met for exactly that. When a nightly job finds something it can safely put right (leave after someone has left, a sick shift, a pending request nobody can approve), it should put it right and record it; refuse only for what genuinely needs a person (someone still clocked in, a shift that needs cover). And check the step after the one that failed: removing the login would have failed for every leaver too.

## 2026-11-03 Do the follow-ups, do not offer a menu of them
- After the leaver fix shipped, I listed four follow-ups and asked which to start. The owner had already asked for everything outstanding to be found and fixed, and said we keep going backwards and forwards. When the owner has asked for completeness, work through every follow-up in one go and batch only the approvals the rules require (live data changes, production migrations) into one list at the end. Never end a turn by asking which item to do first.

## 2026-11-03 A question about a document must show what the document says
- Two of the six staff training questions came back as "what do you mean?": what age counts as a "child" for the licence, and which rooms are the yellow dining area. Both pointed at the premises licence without saying what it says or showing the plan. When a question depends on a document, quote or summarise the exact condition, show the part of the plan or page it means, and say what each answer would change.

## 2026-11-04 Read how the business pays before building pay logic
- PR 304 gave leavers a pro-rated "earned" holiday allowance and an untaken-holiday figure "to include in their final pay", and I told the owner a leaver had taken 16.4 days more than she had earned. Staff here are on rolled-up holiday pay (12.07% on every payslip, `src/lib/worker-agreement-template.ts`), so nothing is owed either way when they leave. I took the textbook accrual model as fact without reading the contract staff sign.
- Before any pay, holiday or leave logic, read the worker agreement and the payroll code for how the business actually pays it, and quote it in the plan. A legal default is not this business's rule.
