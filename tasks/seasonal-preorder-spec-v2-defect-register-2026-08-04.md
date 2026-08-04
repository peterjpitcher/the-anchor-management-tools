# v2 specification: blocking defect register

Date: 2026-08-04
Document under test: `tasks/seasonal-preorder-journey-spec-v2-2026-08-04.md`
Method: three independent adversarial readers (buildability, internal consistency, findings closure),
each told to default to reporting a problem when unsure.

Verdicts: two of three said DO NOT SHIP.

The same migration failure was found independently by all three readers, which is the clearest
signal in the set: the specification does not compile.

Total blocking defects: **35**.
---

## Reader 1: verdict `ship_with_named_open_decisions`

### B1. Migration M2 cannot be applied as written. `preorder_contact_is_covered(uuid)` is a Phase 1 function (§12.4, created in M2) declared `LANGUAGE sql`, and its body selects from `public.booking_preorder_permission_evidence`, which §9, §10.11 and §12.4 all say is a Phase 2 table not created in Phase 1. With `check_function_bodies` at its default of `on`, PostgreSQL validates a SQL-language body at CREATE time and M2 aborts with 42P01. The same contradiction runs the other way in Part 3 §13.4, which states that a Phase 1 evidence row is still written into that table.

**Where:** Part 1 §10.8 (function body), §9 table list, §10.11, §12.4, §13 M2; Part 3 §3.2 Gate 1, §13.4

**Why it blocks:** This is the migration that carries every invariant the F04 answer depends on, and it will not apply. The document shows it understands this exact class of problem (§3.2 says the Gate 2 suppression clause 'does not parse in Phase 1 and must not be written') but missed it for Gate 1. It also leaves F12's Phase 2 deferral self-contradictory: three sections say the evidence table is Phase 2, one says a Phase 1 row is written into it, and the Phase 1 send gate reads it.

### B2. The reconciliation query nominated as the single detector of missed pre-orders cannot see the population it exists for. It inner-joins `booking_preorder_orders`, so a booking with no order row at all is excluded from the result set entirely.

**Where:** Part 1 §10.4 and Part 3 §9.4 (the identical query, described as 'the preflight check, the dashboard counter and the covers_mismatch alert'); consumed by Part 2 AC-C 8, Part 3 §8.3 preflight check 12, §11.2 health counter

**Why it blocks:** Part 2 §2.5 states the exact failure it must catch: bookings taken while `preorder_module_enabled` was false get no order row and are 'invisible to every screen that exists to chase them'. The query returns zero rows whether or not that gap exists, so preflight check 12 and acceptance criterion AC-C 8 pass vacuously and the G3 repair sweep has no verification. Christmas bookings taken before activation could be silently uncatered. It needs a LEFT JOIN from `table_bookings` with an `o.id IS NULL` branch, or a second query.

### B3. A legacy-format customer phone number will kill a booking, which is the one outcome the creation design promises can never happen. The AFTER INSERT bootstrap trigger inserts the booker contact with 'phone from customers' (Part 2 §2.2 step 6), but `bpc_phone_ck` requires `^\+[1-9][0-9]{7,14}$`. VERIFIED: `chk_customer_phone_format` in `supabase/migrations/20251123120000_squashed.sql:1966` also permits the UK national form `^0[1-9]\d{9,10}$`.

**Where:** Part 2 §2.2 step 6 and §2.3; Part 1 §10.3 `bpc_phone_ck`

**Why it blocks:** §2.3 states the rule as absolute: 'A raise inside this trigger kills a booking ... The only condition allowed to raise is a genuine invariant breach.' A CHECK violation from a customer row stored in national format is not an invariant breach but it will raise, inside the booking transaction, and the guest loses the booking. §10.3 says the index 'only works if every write normalises to E.164 first (formatPhoneForStorage)', but the bootstrap write is SQL inside a trigger and cannot call that TypeScript helper. The spec must say what the trigger does with a non-E.164 source value.

### B4. F23's central deliverable, the period transition matrix, is delegated to a document that does not exist. Part 3 §7.9 says 'The full transition matrix is in `D-payments.md` §6.3 and is adopted unchanged'. VERIFIED: no file named `D-payments.md`, `C-privacy.md`, `G-delivery.md` or `CANON.md` exists anywhere in either repository or in git history.

**Where:** Part 3 §7.9 (transition matrix), §7.5, §13.1 ('line references in C-privacy.md §C.1 and must be re-read before Phase 2 starts'), §2.1; against Part 1 §1 Document control

**Why it blocks:** The review asked specifically for 'a transition matrix for no period, same period and different period, including paid/unpaid and before/after cutoff states'. The spec's own Document Control says the working papers 'are superseded background and must not be built from', so the answer is simultaneously delegated to a missing file and forbidden. The four bullets after §7.9 are outcomes, not the matrix. A paying third-party developer cannot obtain the content.

### B5. The F31 disposition entry points at the wrong content and marks an open decision as closed. It reads 'Closed | §10.9, one `preorder_alerts` table, one digest path through the single outbox', which is F32's answer. F31 is about the linked analytics gate (400 sessions per arm) conflicting with D5's delete-now, and about pinning linked requirements to a commit.

**Where:** Part 1 §7 disposition row F31; real substance at Part 3 §10.3.1, §10.4, §11.3; register item OA1 in §14.4

**Why it blocks:** The decision is explicitly still open: §14.4 OA1 asks whether the analytics gate was knowingly waived and says to read the production value of `booking_options_step1` (U8) before answering. So F31 is an open owner decision blocked on an unread production value, not a closed finding, yet the §7 totals table counts it inside the 32 closed.

### B6. The backfill 'commit' mode writes to a store the design deliberately does not create. §9.3 says commit 'writes no change to any booking. It creates the call-list tasks and the manager alert', but there is explicitly no `preorder_backfill_runs` table, the call-list CSV is 'generated live ... never stored', and no task entity, table or column is defined anywhere in the document.

**Where:** Part 3 §9.3; Part 1 §9 ('No `preorder_backfill_runs` table'); Part 2 §7.6.8

**Why it blocks:** Commit is the manager-approval gate the whole F35 answer rests on, and the CSV carries an `outcome` column (`to_call`, `called_accepted`, `called_declined`, `unreachable`, `no_action`) that has nowhere to be recorded. The stated idempotency property, 'running commit twice produces the same call list, not two', is unimplementable without a store. Either name the store and give it a retention rule, or say plainly that commit writes only the alert row and the outcome column is the manager's own copy.

**Non-blocking issues raised by this reader:**

- The 'customer with no phone' branch is self-contradictory. Part 2 §2.3 and AC-C 4 say no order row is created and an alert is raised, but `booking_preorder_contacts.phone_e164` is nullable and the Phase 1 enrolment table (Part 3 §2.10) puts the booker on email at T0, C2 and CUT. Refusing to create the order leaves the booking permanently uncovered; creating it with a NULL phone works. State which, and say whether `preorder_create_order` itself refuses or only the trigger, because G3 calls the function every 15 minutes.
- The `booking_periods` DDL for `chase_offsets_days` and `chase_anchor` appears twice with non-identical CHECK bodies: Part 1 §12.2 uses `coalesce(array_length(...),0) BETWEEN 0 AND 2`, Part 3 §2.4 uses `array_length(...) BETWEEN 0 AND 2`. Both blocks are full ALTER TABLE ADD COLUMN statements, so a developer applying both gets a duplicate-column error. Delete the Part 3 copy and cross-reference.
- Part 1 §5.6 says its four capacity numbers 'are the only ones' and that §11.7 must not diverge, then Part 3 §11.7 adds five more budgets (save one cover under 500 ms p95, 60 pickers interactive under 1 s, any cron under 30 s, scheduler batch 200, outbox drain 15 minutes). Either fold them into §5.6 or drop the must-not-diverge instruction.
- Part 1 §11.6 and test T30 both assert that 'all twelve tables' are RLS-enabled and service-role-only, but Phase 1 creates nine. The Phase 2 and refund-workstream tables cannot be covered by a Phase 1 migration or test.
- Phase 1 declares the `sms_budget_exceeded` alert type (Part 1 §10.9) and §11.2 alerts on chase messages 'above the daily budget', but the daily seasonal SMS budget setting is only introduced in §13.5 as a Phase 2 control. Phase 1 has no budget value to compare against.
- Retention has no `D` value for `message_class = 'alert'` outbox rows. `bpx_shape_ck` forces `table_booking_id IS NULL` on them and §5.1 defines D as `booking_date`. §5.2 solves the same problem for `preorder_alerts` (deleted 2 years after `first_seen_at`) but not for the outbox.
- Updating the existing TypeScript party-size amendment path to call `preorder_plan_shrink` and `preorder_apply_amendment` is mandatory Phase 1 work, because the I2 deferred trigger will otherwise abort every seasonal party-size change at commit (§11.2 says so in as many words). It appears only in Part 2 §7.6.7 and is absent from the Phase 1 scope table in Part 1 §5.2, which is the list the developer is asked to estimate against.
- Nothing enforces the §7.9 rule that changing the seasonal answer is refused. Part 2 §4 VERIFIES that `booking_period_answer` is written only at creation, and the new staff action sets it true, but no constraint or trigger stops an accepted-to-declined flip on a booking that already has an order, chases and covers. That was one of the transitions F23 named.
- F42's caveat is honest about estimates but silent about the other half of the ask. No decision deadlines are set for OB1 to OB6 or L1 to L8, and OB2 gates all website work against an October target. 'Partly closed, stated honestly' should name the missing dates as well as the missing estimates.
- F37 is marked plain 'Closed', but its analytics-waiver half is an open owner decision (OA1) and its deletion half is an adjacent workstream (§10.3.1). The rollback substance genuinely is closed; the label overstates the rest.
- Every SECTION-CLAIMED item in the document resolves to a lettered working paper that exists in neither repository. §1.2 does tell the developer to confirm before build, so this is recoverable, but it means no citation in the document can be followed, only re-derived from source. F36 asked for reproducible evidence.

## Reader 2: verdict `do_not_ship`

### B7. The Phase 1 send gate reads a Phase 2 table, so migration M2 cannot apply.

**Where:** Spec lines 1234-1240 vs 463, 1352-1356, 1857, 1884-1885, 4108-4110, 6428-6431

**Why it blocks:** §10.8 defines `preorder_contact_is_covered` as `LANGUAGE sql` with `OR EXISTS (SELECT 1 FROM public.booking_preorder_permission_evidence pe ...)` (l.1238). §12.4 tags that function Phase 1 (l.1857) and M2 contains "Every `preorder_*` function" (l.1885). But §9 tags `booking_preorder_permission_evidence` as Phase "2" (l.463), §10.11 says "Neither ships in Phase 1" (l.1354), and M1 creates only "the nine Phase 1 tables" (l.1884). PostgreSQL validates `LANGUAGE sql` bodies at CREATE time (check_function_bodies is on by default in Supabase), so M2 aborts with "relation ... does not exist". The document proves it understands this exact hazard one page later: §3.2 says the Gate 2 suppression clause "does not parse in Phase 1 and must not be written" (l.4108-4110), yet applies the reasoning to Gate 2 only. Compounding it, §13.4 states "A Phase 1 evidence row is still written, in reduced form ... phone_hmac = NULL, one row for the booker's own contact" (l.6428-6431), which requires inserting into a table the same document says does not exist in Phase 1.

### B8. The `booking_periods` column DDL is given three times, twice with a different CHECK, and applying two of them fails.

**Where:** Spec lines 669-672, 1761-1772, 3783-3792, 1886

**Why it blocks:** §10.2.2 issues `ALTER TABLE public.booking_periods ADD COLUMN preorder_cutoff_hour_local smallint NOT NULL DEFAULT 12 CHECK (...)` (l.669-671). §12.2 issues the same ADD COLUMN again plus `chase_offsets_days` and `chase_anchor` (l.1761-1766). §2.4 issues `chase_offsets_days` and `chase_anchor` a third time (l.3783-3786). The two array CHECKs differ: §12.2 reads `coalesce(array_length(chase_offsets_days, 1), 0) BETWEEN 0 AND 2` (l.1770) and §2.4 reads `array_length(chase_offsets_days, 1) BETWEEN 0 AND 2` (l.3790). Only M3 is told to carry them ("the `booking_periods` columns and CHECK (§12.2)", l.1886), so §10.2.2 and §2.4 are unattributed duplicates. A developer transcribing the SQL blocks in reading order gets a duplicate-column error, and there is no statement anywhere saying which of the two CHECK texts is canonical.

### B9. Phase 1 has nine tables, but the grants section and the RLS acceptance test both say twelve.

**Where:** Spec lines 450, 465, 1731-1735, 1884, 6145

**Why it blocks:** §9 states "**9 tables in Phase 1. 12 in the full design. 3 views.**" (l.450) and M1 creates "the nine Phase 1 tables" (l.1884). §11.6 then states "**Table grants.** All twelve tables: RLS enabled, one `FOR ALL TO service_role` policy, `REVOKE ALL FROM anon, authenticated`" (l.1731-1732), and test T30 asserts "All twelve tables service-role only" (l.6145) as a Phase 1 database test. Three of the twelve do not exist in Phase 1, and one of them, `booking_amendments`, is listed at l.465 as belonging to the separate refund workstream, so this feature has no business granting on it at all. As written, T30 fails on a correct Phase 1 build, and a developer who takes §11.6 literally will try to create the Phase 2 tables early.

### B10. The outbox is promised a two-year retention but is cascade-deleted at D+90 by its own foreign key.

**Where:** Spec lines 1123-1124 vs 4577, 4582

**Why it blocks:** §10.8 declares `contact_id uuid REFERENCES public.booking_preorder_contacts(id) ON DELETE CASCADE` (l.1124). §5.2's retention row for `booking_preorder_contacts` says "Row deleted" at D+90 (l.4577). §5.2's row for `booking_preorder_outbox` says the operational fields are "kept **2 years** to reconcile SMS spend" (l.4582). Deleting the contact at D+90 destroys every outbox row for that contact, so the two-year SMS reconciliation record cannot survive its first retention run. Two sides of the same document specify incompatible lifetimes for the same rows, and the DDL wins silently.

### B11. `occasions_consumed` counts notice rows, which the cap rules say sit outside the cap.

**Where:** Spec lines 1169, 1414, 3940, 3942-3944, 3983

**Why it blocks:** `bpx_point_ck` permits `chase_point` values including `'NOTICE'` (l.1169). §10.12 defines "`occasions_consumed` counts **distinct** `chase_point` values in terminal sent states, excluding `ESC`" (l.1414) and §2.10 repeats it verbatim with the same single exclusion (l.3942-3944). But §2.10 also states "`notice` rows sit outside the cap" (l.3940) and §2.11 answers "Does it consume the cap? **No.**" (l.3983). Under the stated formula a single withdrawal notice permanently burns one of the booker's four occasions. Elimination rule 6 then cancels a real chase with `skipped_cap` (l.3832), so a menu change silently costs the pub a reminder it was told it would not cost.

### B12. `covers_mismatch` alert severity is defined twice with opposite answers.

**Where:** Spec lines 1287-1288 vs 2168-2172, 5989

**Why it blocks:** Part 1 §10.9 states "`critical` (`refund_failed`, `covers_mismatch`) sends immediately" (l.1287-1288), making severity a property of the type. Part 2 §2.5 states "`covers_mismatch` carries `critical` **only** when the mismatch was not repaired ... **A G3 repair carries `warning` and goes into the 15-minute digest**" (l.2168-2171), and Part 3 §11.4 restates "Severity is per row, not per type" (l.5989). Both places name the same failure mode of getting it wrong: the activation repair sweep sending one immediate email per repaired booking. A developer implementing Part 1's rule reproduces exactly the failure Parts 2 and 3 exist to prevent.

### B13. The readiness check on the guest routes is ordered before token resolution in one place and after it in another.

**Where:** Spec lines 1817-1819, 2310 vs 3366-3369

**Why it blocks:** §12.3.1 places the flag check at "Route handler, **before token resolution**" with behaviour "**404.** Do not confirm the token exists" (l.1817), repeated for the save and data routes (l.1818-1819), and §3.3's `module_off` row cites it (l.2310). §7.6.5's mandatory handler order is: "1. `guest_preorder_ip` throttle, before the token lookup. 2. Resolve the token by hash ... 4. Readiness flags. False means **404**" (l.3366-3369). Step 2 resolves the token before step 4 reads the flags, which is precisely the disclosure §12.3.1 forbids. The document says of §7.6.5 "every step is required" (l.3364), so there is no way to satisfy both.

### B14. `order_revision` is documented as written at compose time but is required at insert and read while pending.

**Where:** Spec lines 1132-1133, 1191, 4002, 4318-4321

**Why it blocks:** The column comment reads "-- A COPY of booking_preorder_orders.revision at compose time. Drives the stale-body rebuild." (l.1132-1133). The same table's `bpx_shape_ck` requires `order_revision IS NOT NULL` for `message_class = 'chase'` (l.1191) and for `'notice'` (l.1194), so the scheduler cannot insert a row without it. §2.12 step 4 rebuilds "Every `pending` outbox row for that contact whose `order_revision` is behind" (l.4002) and reconciler pass 5 does the same (l.4318-4321), both of which require the value to be present while the row is still `pending`. §3.8 correctly lists only "`recipient`, `body`, `subject` and `body_html`" as claim-time fields (l.4339). The comment contradicts the constraint and both consumers.

### B15. Only one live escalation row per booking is possible, but five concurrent escalation situations are specified.

**Where:** Spec lines 1195-1197, 1211-1213 vs 4372-4380

**Why it blocks:** `bpx_shape_ck` forces `message_class = 'escalation'` to carry `chase_point = 'ESC'` and `contact_id IS NULL` (l.1195-1197), and `bpx_booking_esc_live_uq` is `UNIQUE ON (table_booking_id) WHERE chase_point = 'ESC' AND status IN ('pending','sending')` (l.1211-1213). §3.10 then lists five manager escalations "all `message_class = 'escalation'` or `'notice'`" (l.4372-4380), including "The booker becomes unreachable on both SMS and email" and "Party grows after the cutoff", both immediate and both able to coexist with the pending cutoff `ESC`. A `notice` row cannot substitute, because `bpx_shape_ck` requires `contact_id IS NOT NULL` on notices (l.1192-1194), so a notice goes to the guest and not the manager. The second escalation raises a unique violation inside the amendment transaction.

### B16. The two access matrices give opposite answers on whether an FOH user sees the contact phone number, and the privacy matrix is labelled Phase 1 while granting access Part 2 defers to Phase 2.

**Where:** Spec lines 3505-3513 vs 4486, 4496-4511, 2469, 2478-2480

**Why it blocks:** Part 2 §8's operational matrix reads "Contact phone numbers | FOH-only user: **No** | `.view` Yes | `.edit` Yes | `.manage` Yes" (l.3513). Part 3 §4.4, headed "Field-level access, **Phase 1**" (l.4486), reads "The booker's own number (already on the booking record) | Booker M | FOH **F, unchanged from today** | BOH **F, unchanged from today**" (l.4500). In Phase 1 the only `booking_preorder_contacts` row is the booker, so these two tables describe the same datum and disagree. §4.4 also grants FOH full `dietary_note` on a detail view (l.4504) and full dish selections (l.4502) in Phase 1, while Part 2 §5.3 puts the FOH surface S7 in Phase 2 (l.2469) and §5.3 states FOH users are blocked from every `/api/boh/*` route so "an FOH view needs its own `/api/foh/*` route, which is genuinely separate work" (l.2478-2480). T43 requires "One test per **N** and **M** cell of §4.4" (l.6158), so the test matrix inherits the wrong phase.

### B17. Preflight check 12 requires a backfill dry run that the readiness gate refuses to run before activation.

**Where:** Spec lines 1831, 5578, 5595, 5603-5606

**Why it blocks:** §8.3 states "Activation means setting `preorder_module_enabled` to true. It is gated by a checklist" (l.5578) and check 12 requires "The backfill dry run has been produced, reviewed and reconciled, and the §9.4 query returns zero rows" (l.5595). §12.3.1 gates "Backfill dry run and commit" on `module` with behaviour "409 `PREORDER_NOT_ENABLED`" (l.1831). §8.4's activation order then places the backfill at step 3, after `preorder_module_enabled -> true` at step 1 (l.5603-5605). The checklist that gates step 1 contains an item that cannot be completed until after step 1.

### B18. The capacity sizing basis is stated three times and the three do not agree, including a claim about the planning row that the planning row contradicts.

**Where:** Spec lines 251, 2809-2825, 6052-6058

**Why it blocks:** Part 1 §5.6 pins four numbers and warns "**These four numbers are the only ones; Part 2 §5.11 and Part 3 §11.7 restate them and must not diverge.**" (l.251). Part 2 §5.11 restates them and asserts "The figures above are ASSUMED at roughly 30 bookings and 250 covers, which is the planning row of Part 3 §11.7" (l.2823-2824). Part 3 §11.7's planning row is "**Planning** | **60** | **520**" (l.6055); its low row is 15 and 130 (l.6054). Neither is 30 and 250. §11.7 also fails the no-divergence instruction: it omits the 800 ms `preorder-day` budget and the 60 s print budget entirely and adds four budgets Part 1 does not carry (l.6062-6068). A developer sizing indexes and the print cap has three different volume assumptions and no stated winner.

### B19. `preorder_create_order` is required to behave two different ways from one signature with no mode argument.

**Where:** Spec lines 636-645, 1814, 1845, 2115, 1949

**Why it blocks:** §10.2.1 states "**Two callers, two behaviours, and they are not a contradiction**" (l.636): the bootstrap trigger "**Returns NULL and raises a `preorder_alerts` row. It never raises.**" while "A direct call to `preorder_create_order` ... **Refuses**" with a plain-English sentence (l.639-640). §12.4 gives one signature, `preorder_create_order(uuid, jsonb)` (l.1845), and §2.2's trigger pseudocode places the no-main test inside the trigger at step 4 (l.2115) while also saying the trigger's job is "calling the canonical function" (l.2102-2103). Nothing says which side owns the check or how the function distinguishes its caller. Test 25 asserts the refusal (l.1949) and AC-C 4 asserts a booking still commits when the period is unreadable (l.3546-3548). Implemented in the function, a raise kills a booking, which §2.3 calls the one outcome that must never happen (l.2134).

**Non-blocking issues raised by this reader:**

- The binding naming rule at l.443 says "Every child of the order carries `order_id` and `booking_period_id` ... and points at its parent with a **composite** foreign key", and `bpo_id_period_uk UNIQUE (id, booking_period_id)` (l.569) exists to be that target. `booking_preorder_amendments` breaks it: `order_id uuid NOT NULL REFERENCES public.booking_preorder_orders(id) ON DELETE CASCADE` (l.999-1000), single column, no `booking_period_id`. Either the rule is not binding or the DDL is wrong.
- `needs_kitchen_call` is both a guest-controlled checkbox and a system-derived flag. Part 2 §3.2 gives "A `needs_kitchen_call` checkbox, labelled `Please ring me about this person's allergy`" (l.2292); Part 3 §4.3 states "`other`, or any non-empty note, sets `needs_kitchen_call = true`" (l.4460). If the system sets it, the guest cannot untick it, and the field's meaning on the kitchen sheet differs depending on which rule was built.
- `preorder_alerts.alert_key text NOT NULL UNIQUE` (l.1255) makes an alert key single-use for all time, but §11.4 specifies auto-resolve ("An alert whose condition no longer holds is set `resolved` by the next sweep", l.5992) and re-raise ("Re-raising an open alert increments `occurrence_count`", l.5983). A recurring condition such as `outbox_stalled` or `sms_budget_exceeded` can therefore never alert a second time after it has once resolved.
- The document control table says the AMS repository is on "branch `work/outstanding-book-table-2026-08-03`, review snapshot `63525547`" (l.49); Part 3 §10.1 says AMS is on `main` at `63525547`, merged (l.5781). Live `git rev-parse` in the AMS tree currently reports branch `main` at `63525547961f...`, matching Part 3. Part 1's row should be corrected.
- Whether a `blocked` cover is chased is stated twice, differently. §6.1: "Chasing stops for a contact when `contact_state` is `complete` or `inactive`, and only then" (l.298), which keeps a blocked contact in the queue. §6.2's worked example for cover 5 says "Yes, with a notice, not a chase" (l.310). §2.11 only guarantees one notice at withdrawal time (l.3982-3983), and reconciler pass 4 cancels pending rows only for contacts that are complete, opted out or unreachable (l.4316), so the chase does continue.
- "`status` ... is never hand-set, with one exception: **`abandoned` is set only by an explicit staff action**" (l.612-614) is contradicted by the cancellation path, where the trigger `preorder_sync_order_on_booking_status` sets `status = 'cancelled'` (l.1632, l.2239). There are two exceptions, not one, and Part 2 l.2218 repeats the "never hand-set" line with neither.
- §7.5 opens "`Idempotency-Key` is **required** on every POST in this feature" (l.3137) and closes "**Guest saves do not use `Idempotency-Key`**" (l.3151). The error table also carries `IDEMPOTENCY_KEY_REQUIRED | 400 | Idempotency-Key missing on a POST` (l.3106). The hashed-fields table also omits the staff sign-off, lock, unlock and bulk sign-off POSTs of §7.6.8.
- The outbox send-gate `BEFORE UPDATE` trigger is mandated twice (l.1227-1230, l.4116-4118) but its function is absent from §12.4, which is titled "The function list, canonical names" and is the list M2's grant lockdown loop is said to cover. Per the l.438 rule it must be named `preorder_*`; nobody has named it.
- Four of the seven crons the document counts (l.5941) have no route path. `preorder-lock`, `preorder-reconcile` and `preorder-retention` are named; the chase scheduler, chase worker, alert digest and D+1 aggregate job are referred to only by role (l.1826-1829, l.4616). Preflight check 5 demands each be present in `vercel.json` (l.5587) with no canonical list to check against.
- L6's blocking target moves between sections: Part 1 §4.2 says it sets "The dietary row of the retention schedule, Part 3 §5.1" (l.178), Part 3 §4.2 says it "sets the dietary row in §5.2" (l.4417), and §14.5 says "The dietary row of §5.1" (l.6570). The number lives in §5.1's table (l.4554).
- The backfill's output artefacts are described inconsistently. §9.3 says "`commit` writes **no change to any booking**. It creates the call-list tasks and the manager alert" (l.5715-5716), but no call-list task table, row or column is defined anywhere, and the same section says "The call list itself is **generated live as a CSV** ... It is never stored" (l.5710-5712) while giving the CSV an `outcome` column with lifecycle values `to_call`, `called_accepted`, `called_declined`, `unreachable`, `no_action` (l.5721). There is nowhere to record an outcome.
- `SEND_HOUR_LOCAL = 10` is hardcoded for the `CUT` chase (l.3755, l.3762) while the cutoff hour is a settings column constrained `BETWEEN 9 AND 21` (l.671). Set the cutoff hour to 9 and the final chase fires an hour after the deadline; elimination rule 2 explicitly exempts `CUT` from the after-cutoff drop (l.2828).
- §12.4 says of `preorder_phone_hmac` "**In Phase 1 it is not created and the claim's suppression subquery is a constant false**" (l.1864), while §3.2 says the Gate 2 clause "**does not parse in Phase 1 and must not be written**" (l.4109-4110). Same outcome, two different instructions for the same lines of SQL.
- Tab 1's "Bookings not signed off" is defined as "Bookings whose `fulfilment_state` is `open`" (l.2532), but the lock cron moves unsigned orders straight from `open` to `locked` (l.2797). After the cutoff the count of unsigned bookings silently drops to zero.

## Reader 3: verdict `do_not_ship`

### B20. The `booking_periods_chase_offsets_ck` CHECK constraint contains a subquery (`NOT EXISTS (SELECT 1 FROM unnest(chase_offsets_days) v WHERE ...)`). PostgreSQL rejects subqueries in CHECK constraints (`0A000: cannot use subquery in check constraint`), so migration M3 fails outright. The document states this rule itself in §10.2 ("a CHECK may call an IMMUTABLE function but may not contain a subquery") and then breaks it. The same constraint is also given twice with two different bodies: Part 1 §12.2 wraps `array_length` in `coalesce`, Part 3 §2.4 does not.

**Where:** Part 1 §12.2 and Part 3 §2.4

**Why it blocks:** M3 will not apply. The developer has to invent a replacement (an IMMUTABLE helper function, as done for `preorder_course_set_ok`) and then decide which of the two divergent bodies is authoritative. Neither is a decision a contracted developer can make against a spec that asserts both.

### B21. `preorder_contact_is_covered(uuid)` is listed as a Phase 1 function (§12.4), is created in M2, and its body selects from `public.booking_preorder_permission_evidence`, which §9 and §10.11 both put in Phase 2 and explicitly say does not ship in Phase 1. It is `LANGUAGE sql`, so PostgreSQL validates the body at CREATE time with `check_function_bodies` on. M2 fails with "relation does not exist".

**Where:** Part 1 §10.8 (function body), §9 and §10.11 (table is Phase 2), §12.4 (function is Phase 1), Part 3 §3.2

**Why it blocks:** The spec spotted exactly this hazard for Gate 2 of the outbox claim ("the Gate 2 clause does not parse in Phase 1 and must not be written") and then failed to apply the same reasoning to Gate 1, which it calls out as "written now in its final form and needs no Phase 2 change". M2 does not apply, and the send gate is the trigger the whole messaging safety argument rests on.

### B22. Direct contradiction over whether `booking_preorder_permission_evidence` exists in Phase 1. §9's table list marks it Phase 2. §10.11 says "Neither ships in Phase 1". Part 3 §5.2 marks it Phase 2. But Part 3 §13.4 says "A Phase 1 evidence row is still written, in reduced form: `wording_key = 'preorder_booker_orders_for_others'`, `phone_hmac = NULL`, one row for the booker's own contact", and gives that as the reason the claim gate needs no Phase 2 change.

**Where:** Part 1 §9, §10.11; Part 3 §5.2 versus Part 3 §13.4

**Why it blocks:** The developer cannot determine whether to create the table, write to it, cover it in the retention sweep, or include it in the grant lockdown. It also decides whether the previous finding is a bug or the table list is wrong. The table's DDL is never given in either case, only a prose description.

### B23. `preorder_create_order` has three mutually incompatible return contracts. §10.2.1 says the bootstrap trigger branch "Returns NULL". §12.3.1 says it "Returns `{ok:false, code:'PREORDER_NOT_ENABLED'}`" when the flags are off. §14.1 test 24 says the second call "returns the same order id". §14.1 test 25 says it "Returns the plain-English refusal". §12.4 gives the signature `preorder_create_order(uuid, jsonb)` with no return type at all.

**Where:** Part 1 §10.2.1, §12.3.1, §12.4, §14.1 tests 24 and 25; Part 2 §2.2 step 5

**Why it blocks:** This is the single function called by the AFTER INSERT trigger, by the staff add-a-preorder action, by the G2 payment guard and by the G3 repair sweep. Four callers cannot be written against a function whose return type is unknown, and a plpgsql trigger cannot `RETURN NULL` from a function that returns jsonb without the caller knowing which it is.

### B24. Invariant I2's deferred trigger will break every live party-size writer, and the spec neither names them nor gives a workable mechanism. Verified writers: `src/lib/table-bookings/manage-booking.ts:766-770` (plain supabase-js `.update()`, no transaction), `src/app/api/foh/bookings/[id]/party-size/route.ts`, `src/app/api/boh/table-bookings/[id]/party-size/route.ts`, and a fourth, SQL-level writer at `supabase/migrations/20260611000000_communal_event_seating.sql:1027` (`UPDATE public.table_bookings SET party_size = p_new_seats` inside the event-seating reallocation function). §11.2 says the trigger "fires on the existing amendment path without changing it" and "it gets an error at commit"; Part 2 §7.6.7 requires `preorder_plan_shrink` then `preorder_apply_amendment` "in the same database transaction as the party-size update".

**Where:** Part 1 §11.2, §11.3; Part 2 §7.6.7; Part 3 §2.8

**Why it blocks:** supabase-js cannot wrap two RPC calls in one transaction, so the stated requirement is not implementable against the current code without converting each writer into a single database function. The spec names no file, no function, no new RPC and no scope for that work, and does not mention the communal-event path at all. As written, the first seasonal party-size change in production fails at commit with a raw constraint error, and the event-seating reallocation function fails too.

### B25. The cron inventory does not exist. Only three routes are named: `/api/cron/preorder-lock`, `/api/cron/preorder-reconcile`, `/api/cron/preorder-retention`. The chase scheduler, the chase worker, the alert digest, the D+1 aggregate job and the daily 08:00 heartbeat are all required behaviour but have no route name, no `vercel.json` schedule, no batch size (except "200 bookings" for the scheduler), no `maxDuration` and no idempotency rule. The text asserts "seven crons" twice without ever listing them; the components described imply eight.

**Where:** Part 1 §5.6, §12.3.1; Part 2 §5.10; Part 3 §3.7, §5.3, §8.3 check 5, §11.2, §11.4, §11.7

**Why it blocks:** Preflight check 5 ("Every pre-order cron is scheduled in `vercel.json`") and the §11.2 health page counter ("Last successful run of each cron") are both unbuildable without the list. The developer cannot scope, schedule, or verify a set of jobs that is never enumerated, and the project's own rule is that `vercel.json` is the source of truth.

### B26. The outbox retention promise is contradicted by its own foreign key. `booking_preorder_outbox.contact_id uuid REFERENCES public.booking_preorder_contacts(id) ON DELETE CASCADE`, and `bpx_shape_ck` makes `contact_id` NOT NULL for every `chase` and `notice` row. Retention deletes contact rows at D+90 (§5.2, §5.3 step 4), which cascades those outbox rows away. §5.2 simultaneously promises that `status`, `cancel_reason`, `provider`, `provider_message_id`, `idempotency_key` and the timestamps are "kept 2 years to reconcile SMS spend".

**Where:** Part 1 §10.8 (DDL); Part 3 §5.2 (outbox row), §5.3 step 4

**Why it blocks:** Two stated requirements cannot both hold. The developer has to choose between changing the FK to `ON DELETE SET NULL` (which then breaks `bpx_shape_ck`), keeping the contact rows past D+90 (which breaks the retention schedule the owner is being asked to approve as OB3), or dropping the 2-year spend-reconciliation claim. That is a design decision, not an implementation detail.

### B27. `bpx_shape_ck` and `bpx_booking_esc_live_uq` cannot express messages the spec requires. (a) §3.9's manual "Resend now" control creates a `notice` row, but `bpx_shape_ck` requires `notice_kind IS NOT NULL` for `message_class = 'notice'` and `bpx_notice_kind_ck` only permits `amendment`, `item_withdrawn`, `cover_dropped`. There is no legal value for a staff resend. (b) §3.10 lists five distinct escalation situations, all of which must be `message_class = 'escalation'` with `chase_point = 'ESC'`, while `bpx_booking_esc_live_uq` is a unique index on `(table_booking_id) WHERE chase_point = 'ESC' AND status IN ('pending','sending')`, allowing only one live escalation per booking and carrying no column that says which situation it is.

**Where:** Part 1 §10.8; Part 3 §3.9 control 2, §3.10

**Why it blocks:** The resend button cannot insert a row. A booking that is incomplete at the cutoff and whose booker has become unreachable on both channels needs two escalations and can only have one, silently losing the second, with no field to tell the manager which condition fired.

### B28. Unlock semantics are undefined. §2.7 permits `unlock` from `locked` with a typed reason, and `bpo_unlocked_reason_ck` exists, but nothing says whether unlocking clears `locked_at`. Part 2 §3.3 makes the guest page `readonly_locked` whenever `locked_at IS NOT NULL` or `now() >= cutoff_at`. The target `fulfilment_state` after unlocking an order that was locked directly from `open` (a path §2.7 explicitly allows) is also unspecified, and `bpo_checked_is_signed_ck` constrains which values are legal.

**Where:** Part 1 §10.2 (DDL); Part 2 §2.7, §3.3, §7.6.8

**Why it blocks:** If `locked_at` is not cleared, unlock changes nothing the guest can see and the feature does not work. If it is cleared, the record of the cutoff lock is destroyed and the lock cron re-locks on its next 15-minute run anyway, because the order is back in `('open','checked')` with `cutoff_at` past. Either way the developer has to invent the rule, and both readings are defensible from the text.

### B29. `GET /api/boh/table-bookings/preorder-day` has no request or response schema. It is described only as "Returns the S2 read model: date, day_fingerprint, generated_at, summary, course_summary, totals[], bookings[] with covers[]". No field names, no types, no nesting, no error body. The same applies to `PUT .../preorder-v2/covers`, the sign-off, lock and unlock endpoints (request bodies partially given, no response shapes), and the print and export routes (no response contract beyond the content type).

**Where:** Part 2 §7.6.8

**Why it blocks:** `preorder-day` is the single endpoint all three tabs of the service-day view read (§5.5, "All three tabs read one endpoint so the numbers cannot disagree between tabs") and carries a named 800 ms budget. Part 2 §7.6 gives full JSON for six other endpoints, so the omission is not a convention, it is a gap. The developer cannot build the screen, the print route or the CSV without inventing the contract, and the three then diverge, which is the exact failure the section says it prevents.

### B30. Function signatures are missing or self-contradictory. `preorder_set_selection(...)`, `preorder_set_cover_details(...)` and `preorder_rebaseline_course_set(uuid, text[], jsonb)` have no parameter lists or return types. `preorder_issue_token(uuid, text, timestamptz)` has three arguments but must carry the contact id, the Node-generated token hash, the expiry AND the revoke reason for the token it replaces (Part 2 §7.6.6 maps four caller reasons onto the stored `revoked_reason`). §12.4 states "Every mutating RPC takes `p_expected_revision` and raises on mismatch", which contradicts the two-argument signatures given for `preorder_create_order`, `preorder_plan_shrink` and `preorder_apply_amendment` in the same table.

**Where:** Part 1 §12.4; Part 2 §7.6.6

**Why it blocks:** Eleven of the twenty-one Phase 1 functions are named without a callable definition, including the two the guest form and the staff modal both write through. A third-party developer would have to stop and ask for each one.

### B31. The booker link handoff at booking creation is unspecified. The public create path is the RPC `create_table_booking_public_v06` (verified at `src/app/api/table-bookings/route.ts:274`); the order, booker contact and covers are created by an AFTER INSERT trigger inside it; the raw token must then be minted in Node outside the transaction (§2.4) and requires the new `contact_id`. Nothing says how the route obtains that id, and `POST /api/table-bookings` is required to return `preorder.order_id` and `preorder.booker_link` in its response.

**Where:** Part 2 §2.2, §2.4, §7.6.2

**Why it blocks:** The RPC's return payload is existing code in `20260803000200_seasonal_deposit_on_create.sql` that must change, and the spec's own rule (§7.2) is that changes to the two existing routes are "strictly additive". Whether the RPC gains return fields, or the route re-queries by booking id after commit, is an unmade design decision on the single most-trafficked path in the feature.

### B32. Two of the three Phase 1 views have no SQL. `v_booking_preorder_contact_status` and `v_booking_preorder_order_status` are given only as column lists, yet they carry semantics the chase ladder and the fulfilment screens depend on: `occasions_consumed`, `transmissions_attempted`, `last_chased_at`, `has_dead_letter`, and a "changed-since-print boolean" that requires calling `preorder_booking_fingerprint(uuid)` per row.

**Where:** Part 1 §10.12

**Why it blocks:** `occasions_consumed` is the cap mechanism (§2.10) and is defined in prose in two places with slightly different wording. The changed-since-print column means the order-status view runs an md5 over every cover and selection of every order it returns, which is the view behind the 800 ms `preorder-day` budget and the 2 s service-day render, and no view definition or alternative is offered.

### B33. The dead-link page has two contradictory copy specifications. Part 2 §3.3 mandates "One identical page for all three" causes (unknown hash, expired, revoked) with the text "This link is no longer active", and states that they "must not distinguish" with no timing difference; AC-T 11 asserts byte-identical pages. Part 3 §12.5 specifies a distinct "Link expired" state with the copy "This link has expired. Ring us on 01753 682707 and we will take your choices."

**Where:** Part 2 §3.3 and AC-T 11 versus Part 3 §12.5

**Why it blocks:** One is a stated security control with a passing-test acceptance criterion; the other is the guest copy table the developer builds the page from. Implementing §12.5 fails AC-T 11. The developer has no basis to choose, and the copy slots are owner-approved content, so guessing is not available either.

### B34. The `course_shape` classification rule for the D+1 aggregate is never defined. The enum permits `main_only`, `starter_main`, `main_dessert`, `all_three`, `incomplete`, and §10.10 says it is "a metric derived from the selection rows at aggregate time", but no mapping is given. Specifically, it is not stated whether an explicit `choice = 'none'` and an absent row map to the same shape, which is the exact distinction owner answer O4 exists to preserve.

**Where:** Part 1 §10.10; Part 3 §5.3 step 1

**Why it blocks:** §5.3's guard refuses the D+90 deletion "unless `booking_period_demand_stats` holds rows for that date for both metrics". Getting the classification wrong therefore either blocks all deletion or destroys the two-year planning data the owner asked for under OB3. This is the one place where the declined-versus-unanswered rule leaves the spec's own text, and it leaves it unresolved.

### B35. The chase anchor is ambiguous whenever the `S_utc - 2h` clamp bites. §10.2.2 stores `cutoff_at := least(computed, booking_start_utc - interval '2 hours')`. §2.3 then defines `CUT` as "10:00 London on the cutoff date" and, for `chase_anchor = 'cutoff'`, `anchor_date` as "the cutoff date", without saying whether that means the pre-clamp date `booking_date - preorder_cutoff_days` or the London date of the stored, clamped `cutoff_at`. §2.6 adds "`CUT`: 10:00 unless the `S_utc - 2h` clamp bites", implying CUT is itself clamped, which is a third reading.

**Where:** Part 1 §10.2.2; Part 3 §2.3, §2.6

**Why it blocks:** For every booking taken inside `preorder_cutoff_days` (the whole §2.7 late-booking case, and case H of the DST table) the two readings give different dates for C1, C2 and CUT. The DST truth table in §2.9 is internally consistent but only exercises bookings taken well before the cutoff, so it does not disambiguate. The developer cannot write the scheduling function, and T11 asserts exact UTC instants against it.

**Non-blocking issues raised by this reader:**

- A3 is answerable from the PostgreSQL documentation rather than by experiment: `WHEN` is permitted on a `CONSTRAINT TRIGGER`, though the condition is evaluated immediately rather than deferred, which is the desired behaviour here. The §11.2 fallback is unnecessary but harmless. Same for U12.
- `bpo_checked_note_ck CHECK (checked_note IS NULL OR length(checked_note) <= 300)` permits an empty string, while §5.10 and §2.7 require 3 to 300 characters for an incomplete sign-off. The lower bound exists only in the application, unlike `bpo_unlocked_reason_ck` which enforces 3 to 200 in the database. Inconsistent for no stated reason.
- `idempotency_key` is `NOT NULL UNIQUE` and §3.4 derives it as `'preorder:' || outbox.id`, but `id` has `DEFAULT gen_random_uuid()`. The uuid must therefore be generated before the INSERT or filled by a BEFORE INSERT trigger. Not stated.
- The existing `upsert_booking_period_menu_item` wraps its UPDATE in `EXCEPTION WHEN check_violation`, which will not catch the `23503` that `bps_menu_item_fk`'s `ON UPDATE RESTRICT` raises (verified at `20260803000100_seasonal_booking_periods.sql:929-943`). §12.1's change must therefore be a pre-check before the UPDATE, not a wider exception handler. Worth saying explicitly, since a developer will reach for the handler first.
- In Phase 1 the four-occasion cap is structurally unreachable: `bpx_point_ck` permits exactly four chase points, so `occasions_consumed` can never reach five. §2.10's claim that the cap "is now doing real work rather than being decorative" is not true for Phase 1, and T19's assertion that a contact "receives exactly four occasions on any configuration" is testing the enum, not the cap logic.
- Nothing prevents `preorder_recompute_order_status(uuid)`, which §12.4 says is "called inside every mutating transaction", from flipping an order whose `status` is `cancelled` back to `open` or `complete`. The state machine in §2.6 shows `cancelled` as reachable from any state but does not mark it terminal, and §11.5 notes staff can still edit a cancelled booking's pre-order.
- How a new cover's `ordinal` is chosen on party growth is unstated. `bpcov_live_ordinal_uk` is partial on live rows only, so a grow could legally reuse the ordinal of a tombstoned cover, producing two covers with ordinal 5 in the audit trail and in `planned_drops` history. "Assigned once, NEVER renumbered" implies max-over-all, but the index only enforces max-over-live.
- `table_bookings.committed_party_size` exists, is NOT NULL, and is maintained alongside `party_size` by every live amendment path (verified at `manage-booking.ts:767-768`, `20260611000000_communal_event_seating.sql:1028`, and both party-size routes). The spec never mentions it. I2 keying off `party_size` is probably right, but it should be stated as a deliberate choice rather than an omission, since the two columns diverge inside the commit window.
- `preorder_alerts.alert_key` is globally `UNIQUE` and `alert_key` is deterministic (`incomplete_at_cutoff:<booking_id>`). §11.4 requires alerts to auto-resolve when the condition clears, but nothing says how the same condition is re-raised afterwards: a second insert on the same key violates the unique constraint, and reopening a resolved row is not specified.
- The chase scheduler's cadence is stated exactly once, in passing, inside a table cell in Part 2 §2.5 G3 ("the scheduler picks it up on its next hourly run"). Nothing else in the document says it runs hourly, and §11.7 gives it a batch size but no interval.
- Part 2 §5.5's per-course risk line and AC-F 40 assume all three courses always render, but `course_set` may legitimately be `{main}` (criterion C5) or `{starter, main}`. Whether the kitchen screen shows a zero row or omits the course is not stated.
- The document is 6,619 lines with cross-references in both directions across three parts. Several rules are stated three or four times (the completeness rule, the phase cut line, the kitchen merge rule, the four switches, the shrink order). That is defensible as redundancy for a third-party reader, but every one of the contradictions found above is between two restatements of the same rule, which is the predictable cost.
