# Lessons Learned

<!-- After every correction, Claude adds a rule here to prevent repeating the mistake. -->
<!-- Format: date, mistake pattern, rule to follow going forward. -->
<!-- Review this file at the start of every session. -->

## 2026-04-20: Always verify day-of-week before sending customer-facing messages

**Mistake:** Sent 32 SMS saying "Music Bingo is this Thursday" when April 24 2026 is a Friday. Required a correction message to all recipients.

**Rule:** When composing any customer-facing message that references a day of the week, ALWAYS compute and verify the day programmatically (e.g. `new Date('2026-04-24').toLocaleDateString('en-GB', { weekday: 'long' })`) before sending. Never assume or calculate mentally.

## 2026-05-28: Serialize operational errors explicitly

**Mistake:** Logged provider/client error objects directly, which hid important diagnostic fields in production logs.

**Rule:** Never `JSON.stringify(error)` directly. Always destructure `code`, `message`, `details`, and `hint` for Supabase errors, or the relevant enumerable fields for provider errors such as PayPal and Twilio.

## 2026-05-28: Keep audit-log writers aligned with schema

**Mistake:** Audit-log writers used legacy column names such as `entity_type`, `entity_id`, `operation_details`, and `metadata` against the canonical `audit_logs` table.

**Rule:** Before adding or renaming columns referenced by an audit-log writer, grep every `from('audit_logs').insert(` callsite and update all writers in the same migration/change.

## 2026-06-10: When deleting a module, grep `tests/` too — not just `src/`

**Mistake:** Deleted `src/app/actions/fix-phone-numbers.ts` (audit F5) after a "zero importers" check scoped to `src/` and `scripts/`. A test in `tests/actions/fixPhoneNumbersActions.test.ts` still imported it, so the Vitest suite broke (suite failed to load). The deletion's verification ran lint + tsc but skipped `npm test` on the "no importers" assumption — and tsc didn't flag it because test files weren't in the type-check include.

**Rule:** Before deleting any module, grep the WHOLE repo for references — `src/`, `scripts/`, AND `tests/` (plus any co-located `__tests__/`). A test file is an importer. If the only remaining reference is a test that exists solely to exercise the deleted code, remove it in the same change. Never skip `npm test` for a deletion just because production code has no importers — run the suite, since tsc may not type-check test files.

## 2026-06-12: A push is not a deploy — always verify the deployment landed

**Mistake:** Pushed the recruitment fix to both apps' `main` and reported the work shipped. The management app auto-deployed (Ready), but the-anchor.pub does NOT auto-deploy `main`, so the website fix sat undeployed and not live. A redesign branch I had published also produced a failing preview build I never checked. The user had to tell me "always verify deployments".

**Rule:** After any push expected to deploy, verify before claiming done. For Vercel: `vercel ls <project> --scope <team>` then `vercel inspect <url>` — confirm a NEW deployment exists, state is Ready (not Error/Building/Canceled), and the production / `git-main` alias points to the new commit (not an older one). Learn each project's deploy model: `anchor-management-tools` auto-deploys `main`; `the-anchor-pub` (website) is a manual production deploy by the user. Never equate `git push` with "live".

## 2026-07-03 — Multi-ticket prod incident (first live booking failed)
- **PL/pgSQL `RETURN QUERY` needs explicit casts**: `sum()` returns bigint; a declared
  `integer` column raises 42804 on EVERY call at runtime, not at migration time. Always
  cast computed columns (`::integer`, `::text`) in RETURNS TABLE functions, and SMOKE-TEST
  each new function with a real `select *` after applying — "migration applied" ≠ "function runs".
- **Gate RPC wrappers on `state`, never on payload presence**: v05's blocked
  `customer_conflict` response CARRIES the existing booking_id. v07 null-checked booking_id
  and mutated a live booking. Wrappers around multi-state RPCs must whitelist success states.
- **Test the retry/conflict path before shipping a booking flow**: happy-path E2E passed;
  the crash only appeared on "customer already holds an active booking" — the single most
  common real-world retry scenario.
- **Browser screenshots are downscaled**: click coordinates read from a 1512px screenshot
  need rescaling to the real 1800px viewport (×1/0.84) or use in-viewport ref clicks.

## 2026-07-07 — Cached local builds masked a type error that failed Vercel

**Mistake:** Reported the AMS branch "green (tsc 0, lint 0, build 0)" and pushed to
`main`; the Vercel build ERRORED on a real TS2367 at `manage-booking.ts:703`
(`preview.is_outside_seating === true` where the value was narrowed to
`false | undefined` inside a `!== true` guard). A Wave-2 subagent had flagged this exact
line; I dismissed it as a "parallel-execution timing artifact" because my later
`npx tsc --noEmit` and `npm run build` both passed — they reused the worktree's `.next`
cache and `.tsbuildinfo`, which skip re-checking unchanged/cached files.

**Rule:** (1) Never dismiss a subagent-flagged type error without reproducing it from a
CLEAN state. (2) Before claiming a build is green ahead of a deploy, run an
UNCACHED build: `rm -rf .next && npm run build` (and delete `*.tsbuildinfo` before a
definitive `tsc --noEmit`). Incremental caches make "works locally" unreliable; the
authoritative gate is what Vercel runs — a cold build. This is doubly true in a fresh
git worktree, where a stale cache can carry a pre-edit clean result forward.

## 2026-07-17 — Never put a subagent's aggregate to the user without running the query

During checklists discovery I told the owner "73% of scheduled shifts have no clock-in,
Billy has never clocked in" and framed it as a KILLER FINDING that broke his design. He
pushed back — "someone's always clocked in when working" — and he was right. The subagent
had counted `status='sick'`, `status='cancelled'` and open (unassigned) shifts as
"didn't turn up". Re-run with `status='scheduled' AND is_open_shift=false AND employee_id
IS NOT NULL`, the real figure is 82–100% per person. Only Billy (Cook, 0/40) and Peter
(Host, 0/8) genuinely never clock in — which is a small, specific, kitchen-shaped problem,
not a design-breaking one.

**Rule:** a headline number that contradicts the owner's direct knowledge of his own
business is a signal the QUERY is wrong, not the business. Before presenting any aggregate
from a subagent as fact — especially one that overturns a user decision — run the query
yourself and check its filters. `rota_shifts` in particular has three traps that inflate a
naive no-show count: `status='sick'` ("Couldn't Work"), `status='cancelled'`, and
`is_open_shift=true` rows with a NULL `employee_id`.

The cost of getting this wrong isn't just the wrong answer — it's asking the owner to
re-decide something on false evidence.

## 2026-07-17 — Finding-level adversarial review misses cross-section contradictions

My five-lens multi-agent review of the checklists spec verified 20 findings against the
code and I applied them all, then an external developer review still found four genuine
contradictions I had written: the floating-task lifecycle conflicted with the sweep and
locking rules two sections later, two accountability rules disagreed about who owns a
miss, a job type had registration instructions but no behaviour, and the rollback section
described only one of Phase 2's five live changes.

Pattern: verify-the-claim review checks each statement in isolation, so it catches wrong
line numbers and false claims about code, but it does not catch section A contradicting
section B, or a lifecycle that dies when two rules interact. Those need a different lens:
walk one object (a floating instance, a missed task, a rollback) through the WHOLE
document end to end and see if every section agrees about it.

Rule: after fixing finding-level review output on any spec, run at least one
walk-an-object-through-the-document pass (or commission one) before calling it buildable.

## 2026-07-18 — `supabase db push --dry-run` does NOT execute DDL; validate in a rolled-back txn

The checklists foundation migration passed `db push --dry-run` but would have FAILED on a
real `db push`: it had a column named `window`, a reserved SQL keyword, which errors on
parse and rolls back the whole migration. The dry-run only checks the file is recognised and
sorts correctly; it never runs the SQL against Postgres, so it cannot catch reserved-word
columns, bad CHECK expressions, or any runtime DDL error. An adversarial reviewer caught it.

**Rule:** before trusting a non-trivial migration, validate that it actually EXECUTES.
Safe technique via the Supabase MCP: first probe that the tool honours transactions
(`BEGIN; CREATE TABLE public._probe(x int); ROLLBACK;` then check the probe did not persist),
then run the ENTIRE migration wrapped in `BEGIN; <migration>; <validation SELECTs>; ROLLBACK;`.
It executes every statement (catching real errors) and persists nothing. All the checklists
DDL is transaction-safe (no CREATE INDEX CONCURRENTLY / ALTER TYPE ADD VALUE), so this works.
Confirm zero leaked objects afterwards.

Also: a Postgres CHECK constraint is satisfied when it evaluates to NULL (unknown), so
`anchor <> 'every' OR every_hours > 0` does NOT reject `anchor='every' AND every_hours IS
NULL` (the `> 0` is NULL). Add explicit `... IS NOT NULL AND ...` guards or the constraint
has a NULL-hole.

## 2026-07-18 — Idempotent "reconcile" generators must preserve deliberately-excluded rows

Building the checklists generation job, the reconcile step retracted (deleted) any pending
instance whose (template, slot) was not in the freshly-computed desired set. But floating
tasks with an already-open pending instance are deliberately EXCLUDED from the desired set
(they must not be regenerated), so on any same-day re-run (a manual "regenerate", or a job-
queue retry of the same payload) the retract deleted the live floating instance and
corrupted its completion-anchored recurrence. The job's own header claimed "safe to retry."

Rule: when a generator both (a) excludes some items from its desired set on purpose and
(b) retracts anything not in the desired set, the retract MUST also skip the excluded set,
or a re-run destroys live data. "Absent from desired" is ambiguous: it can mean "no longer
wanted" OR "deliberately left alone". Distinguish them. Also: never call a reconcile
"idempotent/safe to retry" until you have traced a literal second run, not just the first.

Also from the same review: Efraimidis-Spirakis weighted sampling key is random()^(1/weight),
so with weight = 1/(1+n) the exponent is (1+n), NOT 1/(1+n). The reciprocal silently
inverts the whole distribution (favouring exactly what you meant to de-prioritise) with no
error. Weighted-random direction bugs are invisible without a distribution check.

## 2026-07-28 — Ask questions as a numbered list, always

Corrected by the owner: I ended a reply with five open questions as bullet points.
The global CLAUDE.md already specifies numbered questions (1, 2, 3) with a
recommendation on the same line, precisely so the reply can be "1 yes, 2 no,
3 the second one". Bullets force the owner to quote or re-describe each question
to answer it, which is exactly the friction the rule exists to remove.

Rule: any time a reply ends by asking the owner something, the questions are a
numbered list. One sentence each, plain English, recommendation inline. This
applies to the "You need to:" block as much as to a mid-reply question, and it
applies even when there is only one question, because the numbering signals that
an answer is wanted rather than that a point is being made.
## 2026-07-28 — Renaming a dish silently broke two website code paths

**Mistake:** Renamed "Fish & Chips" to "Beer Battered Cod & Chips" in the production
database before checking what consumed the name, and before the dependent website code
was deployed. The website matches dishes with regexes against the dish NAME:

- `isFishAndChipsFamily` tested `/fish|scampi/`, so the renamed dish dropped out of the
  `/fish-and-chips-heathrow` item list, that page's Product and Menu structured data,
  and the gluten-free exclusion guards.
- `fishPagePriority` pinned the flagship slot to the exact string `^fish & chips$`, so
  with nothing matching, "Half Fish & Chips" was promoted and the page's Product rich
  result advertised the £12 half portion instead of the £15 headline dish.

Both went live before I noticed: the page is ISR with `revalidate = 3600` and had
already refreshed. Neither was caught by types, lint, tests, or the build.

**Rule:** Menu/dish/event names are a load-bearing interface, not just display text.
Before renaming anything customer-facing in the database:
1. `grep` BOTH repos for the old name and for regex matchers over `item.name`
   (`/name/i` near `test(`, `match(`, `includes(`, `startsWith(`).
2. Deploy the consuming code FIRST, then change the data. Data changes take effect
   immediately; code changes need a deploy, so data-first guarantees a broken window.
3. After any rename, re-fetch the live pages that feature that item and diff what
   actually rendered, including the JSON-LD. A green build proves nothing here.

Prefer matching on shape or on a stable id over exact display strings, so the next
rename cannot break it.

## 2026-09-05: Verify ownership wording before publishing

**Mistake:** The citation baseline described The Anchor as independent, but the
business is operated as a Greene King tenanted pub.

**Rule:** Never describe The Anchor as independent. Use neutral venue wording by
default, and record the Greene King tenancy only where ownership is relevant.

## 2026-09-05: Do not remove owner-confirmed dietary options from directory attributes

**Mistake:** The citation baseline treated OpenTable's `Gluten-free Options`
attribute as inaccurate because the website uses the more precise NGCI wording.
That led to the valid OpenTable attribute being removed briefly before the owner
corrected it and it was restored.

**Rule:** The Anchor does have gluten-free options. Retain accurate
platform-controlled dietary attributes such as `Gluten-free Options`. In
free-form customer copy, continue to use NGCI with the approved
cross-contamination caveat. Never remove a venue capability based only on a
wording distinction; verify it with the owner or an operational source first.

## 5 September 2026: dated event capacities

Use the owner-confirmed dated capacities: 60 for the reviewed events, Halloween 150 and Tasting Night 25. Report-level genre examples are not live sellable-capacity instructions. Check the actual booking snapshot before reporting a configured limit.

## 7 September 2026: a click that races an auto-selection effect looks like a slow CI runner

**Mistake:** `MessagesClientResponsive.test.tsx` clicked a conversation row as soon
as `findByRole('option')` resolved. On a loaded GitHub runner the click landed
before React had flushed the pending passive effect that auto-selects the first
unread row, so the synchronous router mock recorded `push(customer-2)` and then
`replace(customer-1)`. Selection ended back on the customer whose response the test
holds open, the `role="log"` pane never rendered, and the failure read as
`Unable to find role="log"`, which looks like a timeout rather than a race.

**Rule:** In these component tests, wait for the component's own auto-selection to
land (for example `waitFor(() => expect(loader).toHaveBeenCalledWith(id, undefined))`)
before firing a click that changes that selection. Getting there by raising a
`waitFor` timeout hides the race and leaves the test asserting nothing. Anchor any
assertion about an async pane with `findBy*`, never a bare `getBy*` after an await,
and scope a "this control is absent" assertion inside the container that has to be
open, or it passes because the container had not rendered yet.

## 8 September 2026: a true sentence that reads as a lie

**Mistake:** The October round-up said "We are open from midday every day except Monday".
Every fact in it is right. The bar opens at midday Tuesday to Sunday, and Monday is the
exception. But the exception attaches to "open" rather than to "from midday", so it reads
as "we are shut on Mondays", and we are not: we open at 4pm. The owner caught it in the
draft. I had checked the hours against `business_hours` and the times were correct, so no
amount of fact-checking would have found it.

**Rule:** Fact-checking copy is not the same as reading it. Before any customer-facing
sentence ships, read it once for what a hurried reader will take from it, not only for
whether each clause is true. Two shapes to watch for, both now enforced by
`findVenueClosureClaims` in `src/lib/email/marketing/`:

- Never hang an exception off a day. Say what the day IS: "from midday Tuesday to Sunday
  and from 4pm on Mondays".
- Do not paraphrase in prose what a table two blocks below already states. The hours block
  was in the same email, and it was right.

The guard warns in the campaign UI and refuses at `scheduleCampaign`, deliberately not in
`validateMarketingContent`: that runs again before every send against deployed code, so a
rule added today would be able to kill a campaign approved last month.

## 9 September 2026: true, accurate, and entirely about us

**Mistake:** The December round-up opened with "Three nights out before Christmas, the
last of the Christmas sittings, and then the quiet stretch between the years when the bar
is open and the kitchen has earned a rest." The owner rejected it. Every fact in it is
right and I had checked every one. The problem is that it is a stock-take: our nights, our
sittings, our kitchen's rest. A reader gets nothing to feel and no reason to come in.

His example of what it should be: "December is finally here, which means we can officially
stop pretending it's too early to get excited about Christmas. The lights are twinkling,
the festive drinks are flowing and there's something about this time of year that makes
even an ordinary evening feel a little more special."

**Rule:** Accuracy is the floor, not the goal. Marketing copy has a second job after being
true, which is to make someone want to be there, and I keep shipping the first without the
second because the first is the one I can verify. Before any customer-facing paragraph
ships, check it describes something the reader will feel rather than something we will do,
and that there is a picture in it. If a sentence is a list of operational facts, it belongs
in a table; the prose beside the table is where the warmth goes. The facts themselves are
never warmed: times, prices and hours stay exactly as the records have them.

## 12 September 2026: a piped build reports the pipe's exit code, not the build's

**Mistake:** I gated the guest email work with `npm run build 2>&1 | tail -12; echo "EXIT: $?"`
and read the resulting `EXIT: 0` as a passing build. `$?` after a pipeline is the exit status of
the last command in it, which was `tail`, and `tail` always succeeds. The build had actually died
with `FATAL ERROR: Ineffective mark-compacts near heap limit` during the type-check phase, and the
only sign of it was a V8 stack trace above my own "EXIT: 0" line. I nearly pushed on that.

**Rule:** Never read `$?` through a pipe. Capture the command's own status first
(`npm run build > log 2>&1; echo "EXIT=$?"`), or use `set -o pipefail`, and grep the log for
`FATAL`, `Failed to compile` and `signal: SIG` rather than trusting a number. A gate that cannot
fail is not a gate.

**The real finding underneath it:** a cold `next build` of this app no longer fits in Node's
default heap on this machine (4192 MB), and it OOMs in "Linting and checking validity of types".
`NODE_OPTIONS="--max-old-space-size=8192" npm run build` passes: compiled in 31s, 155/155 static
pages, 427 routes, exit 0. Use that locally. Deliberately NOT added to the `build` script, because
that script also runs on Vercel, where asking for an 8 GB heap inside an 8 GB container invites the
container to kill the build instead. Vercel's own production builds are passing as they are.
