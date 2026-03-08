---
name: fix-function
description: >
  Deploys a multi-agent specialist team to thoroughly audit, diagnose, and fix an application section.
  Use this skill whenever the user wants a deep, methodical review of a part of their codebase — not just
  surface-level bug fixes, but a full remediation review covering business logic, data integrity, user flows,
  edge cases, and operational correctness. Trigger on phrases like "review this section", "audit this feature",
  "something's broken in [area]", "do a full review of", "fix everything in [path]", "remediation", "deep dive
  into the code", or any request that implies multiple interconnected problems in a section of an application.
  Also trigger when the user describes several symptoms across a feature area and wants them all investigated
  and resolved systematically. This is NOT for single bug fixes or quick patches — it's for when a whole
  section needs to be torn apart, understood, and put back together properly.
---

# App Section Review — Multi-Agent Remediation Skill

You are orchestrating a **remediation project**, not a bug-fixing exercise. The difference matters: bug fixing patches symptoms. Remediation traces problems to their roots, validates business rules against implementation, and fixes things so they stay fixed.

## How This Works

You deploy **four specialist agents** in parallel for discovery, then an **implementation engineer** to fix things, then a **validation pass** to confirm the fixes hold. Each agent has a distinct, non-overlapping lens:

1. **Structural Mapper** — Owns the inventory. Maps files, flows, data models, external dependencies, and state machines. Produces the map everyone else works from. Does NOT assess quality or correctness — just documents what exists and what's missing.
2. **Business Rules Auditor** — Owns policy vs reality. Takes the map and the stated business rules and checks whether the code matches. Finds policy drift, stale logic, wrong values, misleading customer/admin language. Does NOT assess code quality or architecture.
3. **Technical Architect** — Owns structural quality. Assesses architecture, error handling, transaction safety, integration robustness, and technical debt. Specifically hunts for **failure-at-step-N problems** (what happens when step 3 of a 5-step process fails after steps 1 and 2 already committed changes). Does NOT duplicate business rule checking.
4. **QA Specialist** — Owns the test matrix. Builds test cases from business rules and expected behavior, traces each through the code, and logs every defect. The test matrix becomes the **acceptance criteria** for the implementation engineer.

After fixes: a **validation pass** re-runs the full test matrix against the modified code.

## The Rule That Governs Every Agent

Every agent must ask this question about every operation they examine:

> **"What happens when this fails partway through?"**

Multi-step operations are where the worst bugs hide. Payment captured but order not created. Inventory decremented but email not sent. Record deleted but related records left orphaned. Every agent must trace not just the happy path and the full-failure path, but the **partial-failure path** — what happens when step N succeeds but step N+1 fails, and steps 1 through N have already made changes that can't be automatically undone.

This is not optional. This is the single most commonly missed category of defect in production systems.

---

## Before You Start

### Step 1: Gather Context

Before deploying any agents, understand the scope. Ask the user (if not already provided):

1. **Target path** — What section are we reviewing?
2. **Known problems** — What symptoms have they noticed? All of them, even vague ones.
3. **Business rules** — What should this section actually do? Get whatever they have; the auditor will surface gaps.
4. **Priority** — What's most critical? What causes the most damage if it stays broken?
5. **Protected areas** — Integrations, APIs, or behaviors that other systems depend on.

### Step 2: Reconnaissance

Do a quick structural scan yourself before writing agent briefs:
- Read the target directory structure and key files
- Identify module boundaries, entry points, external services, data models
- Get enough context to write specific, targeted briefs

### Step 3: Write Agent Briefs

Each agent gets a brief tailored to THIS section containing:
- Target path and file inventory from your recon
- Known problems from the user
- Business rules (as understood so far)
- Relevant items from `references/review-checklist.md`
- The specific multi-step operations in this section that need failure-path analysis

**Read the agent prompt files** in `agents/` before writing briefs.

---

## Handling Large Sections

If your reconnaissance reveals the target section has more than ~30 files, you need a strategy to keep agents focused and effective:

### Triage by Criticality
During recon, classify files into three tiers:
1. **Critical path** — Files directly involved in the core operations (the ones the user described as broken). Every agent reads these in full.
2. **Supporting** — Utilities, helpers, shared services called by the critical path. Agents trace into these when following a flow but don't need to audit them independently.
3. **Peripheral** — Config, types, constants, test files, styles, etc. Scan for relevant values (hardcoded thresholds, business rule constants) but don't deep-read.

Include the tier classification in each agent's brief so they know where to spend their time.

### Split If Necessary
If the section has distinct sub-domains (e.g., `/table-bookings` has creation, amendments, payments, and communications), consider running the review as multiple passes — one sub-domain at a time — with a final consolidation across all passes. This keeps each agent pass focused and thorough rather than spread thin.

---

## Dependency Boundaries

Agents will encounter code that calls shared utilities, services, or modules outside the target section. The rule:

- **Read one level out.** When a flow calls an external function, read that function to understand its interface, behavior, and failure modes. Include it in flow maps and failure-at-step-N analysis.
- **Do not remediate external code.** If the external dependency is broken, log it as "EXTERNAL DEPENDENCY RISK" with a description of the problem and which flows it affects. It becomes a recommendation for a separate review, not a fix in this one.
- **Do flag external risks in the defect log.** If a shared payment utility has no idempotency, that's a finding even though it's outside scope — because it affects this section's reliability. Tag it with severity but mark the fix as "OUT OF SCOPE — requires separate review of [path]."

This keeps the review focused on what can be fixed within the target section while ensuring nothing dangerous is silently ignored.

---

## Phase 1: Discovery and Audit

Deploy all four agents **in parallel**:

```
- Structural Mapper    → <workspace>/phase-1/structural-mapper/
- Business Rules Auditor → <workspace>/phase-1/business-rules-auditor/
- Technical Architect  → <workspace>/phase-1/technical-architect/
- QA Specialist        → <workspace>/phase-1/qa-specialist/
```

Wait for all four to complete.

### Phase 1 Consolidation

This is where you earn your keep as orchestrator. Do not just "read and summarize." Follow this exact process:

**Step A: Cross-reference defects.**
For every defect the QA Specialist logged:
- Find the corresponding root cause in the Technical Architect's report. If there isn't one, investigate yourself — the architect may have missed the structural reason.
- Find the corresponding business rule in the Auditor's report. If the defect relates to a rule, confirm the auditor identified the same mismatch.
- Find the corresponding flow in the Structural Mapper's report. Confirm the defect's location matches the mapped flow.

Any defect that only ONE agent found gets a confidence flag. Investigate it yourself before including it in the master log.

**Step B: Hunt for gaps between reports.**
- Are there flows the Mapper documented that the QA Specialist has NO test cases for? → Add test cases.
- Are there business rules the Auditor flagged that the Technical Architect didn't assess structurally? → Assess them.
- Are there failure paths the Architect identified that the QA Specialist didn't test? → Add test cases.
- Did any agent identify multi-step operations where the failure-at-step-N path is unhandled? → Ensure this is in the defect log as Critical.

**Step C: Build the master defect log.**
Every issue gets: ID, severity, one-line summary, business impact, root cause area, which agent(s) found it, affected files, and the specific test case ID(s) from the QA matrix that validate the fix.

**Step D: Build the remediation plan.**
Group into: Critical (actively harming business NOW), Structural (fragile/will break under edge cases), Enhancement (should exist but doesn't). Within each group, order by dependency — if fix B depends on fix A, A comes first.

**Step E: Present to user.** Show the defect log, the plan, and ask for sign-off before implementation.

---

## Phase 2: Implementation

Deploy the **Implementation Engineer** with:
- The full defect log (with test case IDs for each defect)
- The approved remediation plan in priority order
- The technical architect's structural recommendations
- The **complete QA test matrix as acceptance criteria** — every fix must reference the specific test case IDs it resolves, and the engineer must self-validate each fix against those cases before moving on

Save to `<workspace>/phase-2/implementation/`.

---

## Phase 3: Validation

Deploy a validation pass (reuse QA Specialist prompt with updated instructions):

1. Re-run the full test matrix against modified code
2. For every defect in the log, confirm the fix works by re-tracing the code
3. Check for regressions — trace adjacent flows that weren't directly modified
4. Validate that every multi-step operation now has proper failure handling
5. Produce a go/no-go with specific evidence for each decision

Save to `<workspace>/phase-3/validation/`.

If validation surfaces new issues: fix → validate → repeat.

---

## Phase 4: Final Report

Produce a consolidated report that states clearly:

1. What the correct rules are for this section
2. What the user/customer sees at each step
3. What admin/staff sees at each step
4. What happens when something fails (including partial failures)
5. What data is stored and why
6. What the code now does vs what it did before
7. How it was tested (reference specific test case IDs)
8. What remains out of scope
9. Recommendations for monitoring, alerts, and future work

---

## Critical Principles

### Trace the Partial Failure Path
Every multi-step operation must have its failure path mapped at every step. "What if it fails HERE, after these previous steps already committed?" This is the #1 source of production defects in transactional systems. Payment captured but order not created. Record deleted but webhook not cancelled. Status updated but notification not sent. Find every one of these.

### Policy Drift Is a First-Class Bug
When code behaves according to old business rules that no longer apply, that's an active defect — same severity as a crash. Old language in customer messages, deprecated workflows that still trigger, legacy rules contradicting current policy. All bugs.

### Hunt What's Missing, Not Just What's Broken
The biggest value of this review is finding what nobody knew was wrong. Agents must actively catalogue: missing error handlers, missing webhook event handlers, missing status transitions, missing validation, missing audit trails. The absence of something is a finding.

### Don't Stack Hacks
Fix root causes. If a function is fundamentally wrong in its approach, refactor it. Don't add conditionals to a mess of conditionals.

### Density Over Structure
Agent reports should be dense with findings. Every line should contain information. Minimize preamble, section introductions, and structural boilerplate. A 50-line report with 50 findings beats a 200-line report with 50 findings buried in prose.

---

## Workspace Structure

```
<workspace>/
├── brief.md
├── phase-1/
│   ├── structural-mapper/report.md
│   ├── business-rules-auditor/report.md
│   ├── technical-architect/report.md
│   ├── qa-specialist/
│   │   ├── report.md
│   │   └── test-matrix.md
│   ├── consolidated-defect-log.md
│   └── remediation-plan.md
├── phase-2/
│   └── implementation/changes-log.md
├── phase-3/
│   └── validation/validation-report.md
└── final-report.md
```
