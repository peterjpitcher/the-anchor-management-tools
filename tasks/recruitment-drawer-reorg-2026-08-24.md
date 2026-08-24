# Recruitment candidate drawer, reorganisation review

Date: 2026-08-24
Subject: the candidate drawer in `src/app/(authenticated)/recruitment/_components/RecruitmentDashboardClient.tsx` (line 2126)
Status: review and recommendations only, no code changed

## 1. What is there today

Header (scrolls away with the content):
name, stage badge, AI badge, role/source/applied, RTW badge, SMS ok, Future ok, email, phone,
"Next step" hint, Open CV, Interview kit, Trial brief, and an inline `<pre>` dump of the printed kit.

Five tabs: Overview, Schedule, Comms, Activity, Profile.

| Tab | Holds |
|---|---|
| Overview | Send interview booking link; stage quick-actions; Reject / Make offer / Already considered / Withdraw / Hold; manual status select; their answers; AI score; CV extraction warning; rationale; strengths; concerns; "Ask about concerns" panel (concerns again + role prerequisites + draft concerns email); CV profile; right to work card; consent card |
| Schedule | Interviews and trials list with outcome/reschedule/cancel behind a `<details>`; booking links (interview + trial); schedule interview directly; schedule trial directly |
| Comms | Six "Draft ..." buttons and a send form; a communications list showing type, status, date, subject |
| Activity | Add note; audit trail mixing notes, status changes, comms, appointments, AI runs and raw system audit rows |
| Profile | Candidate status / other applications; candidate edit form; "Admin": re-score AI, **create employee invite**, archive/restore |

## 2. Findings

### F1. Tabs are named after data types, not after the job being done
Overview / Schedule / Comms / Activity / Profile is a filing cabinet. The user arrives wanting to
decide, arrange or contact. Nothing in the labels maps to those.

### F2. Actions are scattered with no rule, and the most important one is buried
Every action a manager can take on a candidate, and where it lives:

| Action | Today |
|---|---|
| Shortlist / mark interviewed / mark offered / mark hired | Overview |
| Reject / offer / hold / withdraw / already considered | Overview |
| Manual status override | Overview |
| Send interview booking link | Overview **and** Schedule |
| Send trial booking link | Schedule only |
| Schedule interview or trial directly | Schedule |
| Reschedule / cancel / record outcome | Schedule, behind a collapsed "Manage" |
| Draft and send any of 6 emails | Comms |
| Draft concerns email | Overview **and** Comms |
| Add a note | Activity |
| Re-score AI | Profile > Admin |
| **Create employee invite (actually hire them)** | Profile > Admin |
| Archive / restore | Profile > Admin |
| Open CV / interview kit / trial brief | Header |
| Retry CV extraction | Overview |

Hiring someone is the last item, in a section called "Admin", in the fifth tab, called "Profile".

### F3. Common jobs need three tab moves
- "Interview happened, how did it go, book them a trial": Schedule (read outcome) then Overview
  (mark interviewed) then Schedule (send trial link). Three moves for one job.
- "We are hiring them": Overview (Make offer) then Profile > Admin (create employee invite).
- "Check right to work": header pill, Overview card, Profile form. Three places, one editable.

### F4. Decide-before-you-read ordering
Overview leads with stage buttons and puts the evidence (their answers, rationale, strengths,
concerns, CV profile) below. The screen asks for the decision before it shows the reason.

### F5. Duplication
- Interview booking link rendered twice (Overview, Schedule).
- Concerns email rendered twice (Overview, Comms).
- The concerns list rendered twice inside Overview alone.
- AI score as header badge and as a large standalone number in Overview.
- Right to work in header badge, Overview card, Profile form.
- Consent in header badges, Overview card, Profile checkboxes.
- The Comms communications list is a strict subset of the Activity trail (built at line 1534),
  so the Comms tab's history panel adds nothing.

### F6. You cannot read what was sent to the candidate
`recruitment_communications` is selected with `select('*')`, so `final_body` is already in the
drawer's data. The candidate drawer never renders it. To read a sent email you must close the
candidate, go to the dashboard's top-level Communications tab, find the row in a global list and
open a second drawer (line 3991), which does show the body.

### F7. Activity buries the human notes
Notes, status changes, comms, appointments, AI runs and raw audit rows ("update recruitment
application: ai_score, updated_at") interleave in one list with no filter, so the notes staff
actually wrote are lost in machine noise.

### F8. Header and tab strip are not sticky
The DS `Drawer` puts only its own title bar outside the scroll container
(`src/ds/primitives/Drawer.tsx`, `flex-1 overflow-y-auto p-5`). The candidate summary and the tab
strip are inside it, so both scroll away. The header can also render an 80-line `<pre>` of the
interview kit inline, pushing the tabs far down the page.

### F9. The opening tab changes without telling you
Line 1768 opens on Schedule for `interview_invited` and `trial_offered`, Overview otherwise, so the
drawer sometimes lands somewhere different with no visual cue.

### F10. The manual status select competes with the correct path
A 16-option select writing the note "Status changed manually" sits directly beside the curated
stage buttons, with equal visual weight.

### F11. No counts on the tab strip
Nothing indicates whether there are appointments, messages or notes, so staff tab-hunt.

## 3. Recommended structure

Principle: **a persistent action bar plus four tabs named after the question being asked.**

### 3.1 Sticky header, three lines
1. Name, stage chip, AI chip, RTW chip
2. Role, applied date, source
3. Email and phone as `mailto:` / `tel:` links

Open CV moves into the Candidate tab; interview kit and trial brief move into Progress; the printed
kit opens in a modal or new tab rather than as an inline `<pre>`.

### 3.2 Persistent action bar, visible on every tab
Sticky directly under the header (or pinned to the drawer footer, which the DS `Drawer` already
supports via its `footer` prop). It shows one primary action, one or two secondaries, and an
overflow menu holding reject, hold, withdraw, already considered, manual stage change, re-score and
archive. The stage logic to drive it already exists: `quickStatusActionsFor`,
`canSendInterviewBooking`, `canSendTrialBooking`, `canScheduleInterviewForCandidate`,
`canScheduleTrialForCandidate`, `recruitmentNextActionHint`.

| Stage | Primary | Secondary |
|---|---|---|
| new, ai_screened | Shortlist | Reject |
| shortlisted | Send interview booking link | Book interview directly |
| interview_invited | Book interview directly | Resend link |
| interview_scheduled | Record interview outcome | Reschedule |
| interviewed | Send trial booking link | Make offer |
| trial_offered | Book trial directly | Resend link |
| trial_scheduled | Record trial outcome | Reschedule |
| trial_completed | Make offer | Reject |
| offered | Create employee invite | Mark hired |
| hired | none | View employee |
| on_hold | Reopen as shortlisted | Reject |
| rejected, withdrawn | Move to talent pool | Reopen |

The existing `nextActionHint` sentence becomes the caption under the primary button.

### 3.3 Four tabs

| New tab | Question it answers | Absorbs |
|---|---|---|
| **Candidate** | Who is this person and are they any good | Their answers, AI rationale / strengths / concerns, CV profile, Open CV, CV extraction warning, right to work, consents, contact details, other applications, plus the edit form behind one "Edit details" toggle |
| **Progress** | Where are we up to | Appointments with date, time, interviewer, location, calendar sync, outcome and scorecard; schedule / reschedule / cancel; booking links; stage history |
| **Messages** | What have we actually said to them | Full thread newest first rendering `final_body`, plus the composer |
| **Notes** | What do we think, and what happened | Internal notes first, machine audit collapsed behind "Show system activity" |

Tab labels carry counts: Progress (2), Messages (5), Notes (3).

### 3.4 Removals
- Delete the Overview copy of the interview booking link; Progress owns booking links.
- Delete the Overview "Ask about concerns" draft button; Messages owns composing. Keep the concerns
  and role prerequisites as read-only context in Candidate, rendered once.
- Delete the standalone AI score number; the header chip plus the rationale block is enough.
- Delete the read-only right to work and consent cards; the header chip plus the editable field
  in Candidate is enough.
- Delete communications rows from the Activity trail; Messages owns them.
- Move the manual status select into the action bar overflow, labelled "Change stage manually".

### 3.5 Behaviour
- Always open on Candidate. Because the action bar is stage-aware and always visible, the
  surprise jump at line 1768 is no longer needed.
- Wrap the header and tab strip in `sticky top-0 z-10 bg-surface`.

### 3.6 Optional, desktop two-pane
At >=1024px, split the drawer into a main column and a 320px right rail holding the action bar,
the stage timeline and the at-a-glance facts. This removes most remaining tab-hopping. Needs the
drawer width raising from `min(980px, 100vw)` to about `min(1180px, 100vw)`.

## 4. Delivery

Built 2026-08-24, two commits on `main`.

| Step | State |
|---|---|
| Action bar plus sticky header | Done, `cb4fe9ec` |
| Tab merge to four, and the removals in 3.4 | Done, `419a1973` |
| Messages tab renders `final_body` | Done, `419a1973` |
| Notes tab split, human notes first | Done, `419a1973` |
| Two-pane desktop layout (3.6) | Not built, declined as optional |

Verification: `tsc --noEmit` clean, `eslint --max-warnings=0` clean,
`next build` exit 0, full suite 5,682 tests across 680 files passing.
`tests/components/RecruitmentDrawerOrganisation.test.tsx` renders the drawer and
covers the reorganisation directly, including that creating an employee invite is
one click from any tab. The two source-assertion guards in
`tests/actions/recruitmentAuditSource.test.ts` were pinned to the old structure
and now assert the new one.

Changed against the spec above: the sticky header carries no candidate name, since
the drawer's own title bar already shows it, and the role, source, applied date,
email and phone share one wrapped line. Two lines rather than four, because
everything sticky costs screen on a phone.

**Deployed and live**, 2026-08-24. Commit `89b6ecf3` pushed to `main`, Vercel
production build Ready after 5 minutes.

Proof the pushed commit is what production serves, rather than a green check on a
preview:

- GitHub commit status for `89b6ecf3` is `success`, naming Vercel deployment
  `BPPJuo4zesNLTo23et1tcyo6cVyq`.
- `management.orangejelly.co.uk` returns HTTP 200 and stamps every static asset
  with `?dpl=dpl_BPPJuo4zesNLTo23et1tcyo6cVyq`, the same deployment.
- `vercel ls oj-anchor-management-tools --prod` shows that deployment Ready in
  Production, and it is the only production deploy since the push.

Still unverified: nobody has clicked through the drawer in a browser. `/recruitment`
is auth-gated, so the render-level evidence is the component tests, not a session.
