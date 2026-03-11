---
name: fix-function
description: >
  Deploys a multi-agent specialist team to thoroughly audit, research, diagnose, and fix an application
  section or feature. Use this skill whenever the user wants a deep, methodical review and fix of part of
  their codebase — not just surface-level bug fixes, but a full remediation covering business logic, data
  integrity, user flows, edge cases, and operational correctness. Includes a dedicated research phase that
  checks framework docs, API contracts, and project conventions before fixing anything. Trigger on phrases
  like "fix this function", "fix this feature", "fix everything in [path]", "review this section", "audit
  this feature", "something's broken in [area]", "do a full review of", "remediation", "deep dive into the
  code", or any request that implies multiple interconnected problems in a section of an application. Also
  trigger when the user describes several symptoms across a feature area and wants them all investigated and
  resolved systematically. This is NOT for single bug fixes or quick patches — it's for when a whole section
  needs to be torn apart, understood, and put back together properly.
---

# Fix Function — Multi-Agent Remediation Skill

You are orchestrating a **remediation project**, not a bug-fixing exercise. The difference matters: bug fixing patches symptoms. Remediation traces problems to their roots, validates business rules against implementation, researches the correct patterns from authoritative sources, and fixes things so they stay fixed.

## How This Works

You deploy **four specialist agents** in parallel for discovery, then **research** the correct patterns and documented behavior from external sources, then **consolidate** all findings into a remediation plan, then an **implementation engineer** fixes things, then a **validation specialist** confirms the fixes hold. Each agent has a distinct, non-overlapping lens:

1. **Structural Mapper** — Owns the inventory. Maps files, flows, data models, external dependencies, and state machines. Produces the map everyone else works from. Does NOT assess quality or correctness — just documents what exists and what's missing.
2. **Business Rules Auditor** — Owns policy vs reality. Takes the map and the stated business rules and checks whether the code matches. Finds policy drift, stale logic, wrong values, misleading customer/admin language. Does NOT assess code quality or architecture.
3. **Technical Architect** — Owns structural quality. Assesses architecture, error handling, transaction safety, integration robustness, and technical debt. Specifically hunts for **failure-at-step-N problems** (what happens when step 3 of a 5-step process fails after steps 1 and 2 already committed changes). Does NOT duplicate business rule checking.
4. **QA Specialist** — Owns the test matrix. Builds test cases from business rules and expected behavior, traces each through the code, and logs every defect. The test matrix becomes the **acceptance criteria** for the implementation engineer.

After discovery: a **research phase** checks framework docs, API contracts, project conventions, and known issues to find defects invisible from code alone. After fixes: a **validation specialist** re-runs the full test matrix, verifies research-sourced fixes follow documented patterns, and checks for regressions.

---

## Agent File Mapping

Each agent role has a dedicated prompt file in the `agents/` directory. Read the correct file when writing each agent's brief:

| Agent Role | Prompt File | Phase |
|---|---|---|
| Structural Mapper | `agents/structural-mapper.md` | Phase 1: Discovery |
| Business Rules Auditor | `agents/business-rules-auditor.md` | Phase 1: Discovery |
| Technical Architect | `agents/technical-architect.md` | Phase 1: Discovery |
| QA Specialist | `agents/qa-specialist.md` | Phase 1: Discovery |
| Implementation Engineer | `agents/implementation-engineer.md` | Phase 2: Implementation |
| Validation Specialist | `agents/validation-specialist.md` | Phase 3: Validation |

> **Note:** If a file named `discovery-analyst.md` exists in `agents/`, it is a deprecated alias for `structural-mapper.md`. Use `structural-mapper.md` — the content is identical. Delete `discovery-analyst.md` when possible.

---

## How to Deploy Agents

Each agent is deployed using the **Agent tool** with `subagent_type: "general-purpose"`. This is how you translate the skill's phases into actual agent calls.

### Agent Prompt Structure

Every agent prompt you write must include these sections in order:

1. **Role prompt** — The full contents of the agent's prompt file from `agents/`
2. **Brief** — The section-specific brief you wrote (see Brief Template below)
3. **Output instructions** — Where to save their report (the workspace path)

### Parallel Deployment

Phase 1 agents MUST be deployed in parallel — send all four Agent tool calls in a single message. This is critical for speed. Do not wait for one agent to finish before starting the next.

```
# In a single message, call Agent tool four times:
Agent(subagent_type="general-purpose", prompt="[structural-mapper.md contents]\n\n[brief]\n\nSave report to: tasks/review-{section}/phase-1/structural-mapper/report.md")
Agent(subagent_type="general-purpose", prompt="[business-rules-auditor.md contents]\n\n[brief]\n\nSave report to: tasks/review-{section}/phase-1/business-rules-auditor/report.md")
Agent(subagent_type="general-purpose", prompt="[technical-architect.md contents]\n\n[brief]\n\nSave report to: tasks/review-{section}/phase-1/technical-architect/report.md")
Agent(subagent_type="general-purpose", prompt="[qa-specialist.md contents]\n\n[brief]\n\nSave reports to: tasks/review-{section}/phase-1/qa-specialist/report.md and test-matrix.md")
```

Phase 2 (Implementation) and Phase 3 (Validation) are sequential — each depends on the output of the previous phase.

### Context Window Management

Each subagent has a finite context window. To keep agents effective:

- **Include file contents directly in the prompt** for Critical path files (Tier 1). Don't tell agents to "go read file X" — they'll spend context on tool calls. Pre-read critical files and paste their contents into the brief.
- **List file paths only** for Supporting files (Tier 2). Agents will read these as needed when tracing flows.
- **Summarize only** for Peripheral files (Tier 3). Give agents a one-line description of what each peripheral file contains.
- **If a section has >20 Critical path files**, split into sub-domain passes (see Handling Large Sections). No single agent should need to hold more than ~15 full files in context.

---

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
- **Read the project's `.claude/rules/` files** that are relevant to this section (e.g., `auth-standard.md` if the section touches auth, `supabase.md` if it uses the database, `ui-patterns.md` if it has UI components). These define the project's own standards and must be included in agent briefs.
- **Read the project's `CLAUDE.md`** for project-specific conventions, commands, and architecture
- Get enough context to write specific, targeted briefs

### Step 3: Write Agent Briefs

Each agent gets a brief tailored to THIS section. Use the **Brief Template** below. The brief must include:
- Target path and file inventory from your recon
- Known problems from the user
- Business rules (as understood so far)
- Relevant items from `references/review-checklist.md`
- Relevant project rules from `.claude/rules/` (paste the actual content, don't just reference the files)
- The specific multi-step operations in this section that need failure-path analysis
- For Critical path files: the actual file contents (see Context Window Management above)

**Read the agent prompt files** in `agents/` before writing briefs — use the Agent File Mapping table to find the right file.

### Brief Template

```markdown
# Agent Brief: [Agent Role] — [Section Name] Review

## Target Section
- **Path**: [e.g., src/app/(authenticated)/table-bookings/]
- **Project**: [e.g., OJ-AnchorManagementTools]

## File Inventory
### Tier 1 — Critical Path (read in full)
[List files with one-line description of each]

### Tier 2 — Supporting (trace into as needed)
[List files with one-line description]

### Tier 3 — Peripheral (scan for values only)
[List files with one-line description]

## Known Problems
[From the user — every symptom they mentioned]

## Business Rules
[What this section should do — from user description + any rules files]

## Project Standards
[Relevant rules from .claude/rules/ — paste the actual content that applies]

## Multi-Step Operations
[List the specific multi-step operations identified during recon, for failure-path analysis]

## Checklist Items
[Relevant items from references/review-checklist.md for this section]

## Critical Path File Contents
[For Tier 1 files: paste the actual file contents here to save the agent context on tool calls]
```

---

## Workspace Path

All review artifacts are saved to `tasks/review-{section-name}/` relative to the project root. Replace `{section-name}` with a kebab-case identifier for the section being reviewed (e.g., `tasks/review-table-bookings/`, `tasks/review-payment-integration/`).

Create the workspace directory structure at the start of the review:

```bash
mkdir -p tasks/review-{section}/phase-1/{structural-mapper,business-rules-auditor,technical-architect,qa-specialist}
mkdir -p tasks/review-{section}/phase-2/implementation
mkdir -p tasks/review-{section}/phase-3/validation
```

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

### Context Budget Rule
Each subagent should hold no more than ~15 full files in its prompt. If the critical path exceeds this:
- Split into sub-domain passes
- Or further triage: promote only the most critical files to Tier 1, demote the rest to Tier 2

---

## Dependency Boundaries

Agents will encounter code that calls shared utilities, services, or modules outside the target section. The rule:

- **Read one level out.** When a flow calls an external function, read that function to understand its interface, behavior, and failure modes. Include it in flow maps and failure-at-step-N analysis.
- **Do not remediate external code.** If the external dependency is broken, log it as "EXTERNAL DEPENDENCY RISK" with a description of the problem and which flows it affects. It becomes a recommendation for a separate review, not a fix in this one.
- **Do flag external risks in the defect log.** If a shared payment utility has no idempotency, that's a finding even though it's outside scope — because it affects this section's reliability. Tag it with severity but mark the fix as "OUT OF SCOPE — requires separate review of [path]."

This keeps the review focused on what can be fixed within the target section while ensuring nothing dangerous is silently ignored.

---

## Phase 1: Discovery and Audit

Deploy all four agents **in parallel** (see How to Deploy Agents):

```
- Structural Mapper      → tasks/review-{section}/phase-1/structural-mapper/
- Business Rules Auditor → tasks/review-{section}/phase-1/business-rules-auditor/
- Technical Architect    → tasks/review-{section}/phase-1/technical-architect/
- QA Specialist          → tasks/review-{section}/phase-1/qa-specialist/
```

Wait for all four to complete.

### Phase 1b: Research

Before consolidating findings, **stop and research**. Discovery tells you what the code does. Research tells you what the code *should* do according to sources beyond the user's description and the code itself.

This step exists because many defects are invisible if you only compare code against the user's stated rules. A Supabase RLS policy might look internally consistent but violate documented Supabase patterns. A Next.js server action might "work" but use an approach the framework explicitly warns against. A payment integration might handle webhooks in a way that Stripe's own docs say causes race conditions. You cannot find these problems without looking outside the codebase.

**How to research — practical execution:**

- **Read `package.json`** (or equivalent) to identify exact library versions. Version matters — a pattern that's correct in Next.js 14 may be wrong in Next.js 15.
- **Use web search** to check official documentation for the specific features and API methods the code uses.
- **Read the project's own docs** — `CLAUDE.md`, `.claude/rules/`, `README.md`, any `docs/` directory. These define what "correct" looks like for THIS project, and the target section may have drifted from those conventions.
- **Check other parts of the codebase** for how similar operations are handled elsewhere. If every other module uses `fromDb<T>()` but this section doesn't, that's a finding.
- **Search for known issues** when you encounter unusual patterns or suspect bugs.

Don't research everything — focus on the technologies and patterns that the discovery agents actually found in the code.

### Research Budget (Non-Negotiable)

- **Max 5–7 external documentation lookups** per section. Each lookup = checking one library/service's official docs for the specific features used.
- **Max ~15 minutes per service/library** on official docs. If docs are unclear after that, note the ambiguity and move on.
- **Stop criteria:** You have enough research when you can answer "what do the docs say about THIS specific pattern?" for every major technology in the section. You do NOT need to research general best practices, alternative architectures, or libraries the section doesn't use.
- **If the section has >3 external services**, prioritize: payment/financial services first, then auth/security, then everything else.

**What to research — work through this checklist using the discovery reports:**

1. **Framework and library documentation.** For every framework or library the section depends on, check the official docs for the specific features being used. Look for documented gotchas, migration notes, deprecation warnings, recommended patterns vs what the code actually does, and version-specific behavior changes.

2. **API and integration contracts.** For every external service the Structural Mapper identified: check the provider's docs for the specific API endpoints and webhook events being used, verify the code handles all documented response codes and error states, check for idempotency requirements, rate limits, retry guidance, and webhook verification.

3. **Project conventions and shared patterns.** Read the project's own documentation (`CLAUDE.md`, `.claude/rules/`, `README.md`). Check whether the target section follows the same patterns used elsewhere. Identify where the section diverges — each divergence is a potential defect.

4. **Known issues and community guidance.** Search for known issues, GitHub discussions, or Stack Overflow answers related to the specific combination of technologies and patterns in use.

**Output:** Save research findings to `tasks/review-{section}/phase-1/research-notes.md`. Format:

```markdown
# Research Notes

## Framework / Library Findings
[For each relevant finding: what the docs say, what the code does, whether they align, specific doc URL or reference]

## API / Integration Findings
[For each external service: documented contract vs actual implementation, missing error handling, webhook gaps]

## Project Convention Findings
[Where the section follows vs diverges from project-wide patterns, with specific file references]

## Known Issues
[Any relevant known bugs, deprecations, or community-documented gotchas that affect this section]
```

Each finding should be a concrete, actionable item — not vague observations. "Stripe docs require webhook signature verification (https://stripe.com/docs/webhooks/signatures) — `webhookHandler.ts` does not verify signatures" is a finding. "Should probably check Stripe docs" is not.

**Feed research into consolidation.** The research notes become a primary input to the consolidation step — they add a whole category of defects that the four discovery agents cannot find on their own.

---

### Phase 1c: Consolidation

This is where you earn your keep as orchestrator. Do not just "read and summarize." Follow this exact process:

**Step A: Cross-reference defects.**
For every defect the QA Specialist logged:
- Find the corresponding root cause in the Technical Architect's report. If there isn't one, investigate yourself.
- Find the corresponding business rule in the Auditor's report. If the defect relates to a rule, confirm the auditor identified the same mismatch.
- Find the corresponding flow in the Structural Mapper's report. Confirm the defect's location matches the mapped flow.

Any defect that only ONE agent found gets a confidence flag. Investigate it yourself before including it in the master log.

**Confidence tiers for consolidation:**

- **Tier 1 (High):** Found by 2+ agents OR confirmed by research docs. Include in defect log at assessed severity.
- **Tier 2 (Medium):** Found by 1 agent + you can trace and confirm it in the code yourself (10 min max investigation). Include with a "NEEDS VALIDATION" flag.
- **Tier 3 (Low):** Found by 1 agent, no independent confirmation, unclear impact. Do NOT include unless it involves a critical failure path (payment, auth, data loss). Otherwise, note in a "Possible Issues" appendix for the user's awareness.

**When agents disagree** (e.g., Agent A says "RLS is missing" but Agent B says "RLS is present"):
1. Read the code yourself (10 min max)
2. Check the relevant project standard (`.claude/rules/`)
3. Document both interpretations in the defect log with your assessment
4. Do NOT reconcile without seeing the actual code

**Step B: Process and cross-reference research findings.**

Before cross-referencing with agent reports, classify each research finding:

- **Include as defect** if: specific documentation cited + code visibly violates it + affects users/business/operations
- **Include as recommendation** if: docs cite a preferred pattern but current code works correctly
- **Discard** if: speculative, outside scope, or no concrete evidence of harm

Then for every included finding in `research-notes.md`:
For every included research finding:
- Does the codebase violate a documented framework pattern or API contract? → Add to defect log with the specific documentation reference as evidence.
- Does the section diverge from project conventions established elsewhere? → Flag as a finding; assess whether it's a defect or an intentional exception.
- Are there known issues or deprecations that affect flows the Mapper documented? → Cross-reference with the Technical Architect's report and add to defect log if not already captured.

Research-sourced defects are first-class findings — they carry the same weight as defects found by code analysis. Tag them with "SOURCE: research" in the defect log so the implementation engineer knows to reference the documentation when fixing.

**Step C: Hunt for gaps between reports.**
- Are there flows the Mapper documented that the QA Specialist has NO test cases for? → Add test cases.
- Are there business rules the Auditor flagged that the Technical Architect didn't assess structurally? → Assess them.
- Are there failure paths the Architect identified that the QA Specialist didn't test? → Add test cases.
- Did any agent identify multi-step operations where the failure-at-step-N path is unhandled? → Ensure this is in the defect log as Critical.

**Step D: Build the master defect log.**

Use this exact schema for every defect:

```markdown
## DEFECT-{NNN}: {One-line summary}
- **Severity**: CRITICAL | HIGH | MEDIUM | LOW
- **Business Impact**: [2–3 sentences: who/what is affected, consequence if unfixed]
- **Root Cause Area**: [File path(s) + function name(s)]
- **Source**: [Agent names that found it, and/or "research" with URL]
- **Affected Files**: [All files that need modification to fix this]
- **Test Case IDs**: [TC-001, TC-015 — from QA test matrix]
- **Acceptance Criteria**: [Specific, testable condition that proves the fix works]
- **Documentation Ref**: [URL if research-sourced, otherwise N/A]
```

**Severity definitions (use these consistently):**

- **CRITICAL**: Actively breaking user/business function NOW — payment failure, auth bypass, data loss, regulatory violation, customer charged wrong amount
- **HIGH**: Feature broken or severely degraded — user friction, data integrity risk, security gap
- **MEDIUM**: Fragile or incomplete — fails under edge cases but happy path works
- **LOW**: Code quality, maintainability, minor UX — no functional impact

**Step E: Build the remediation plan.**
Group into: Critical (actively harming business NOW), Structural (fragile/will break under edge cases), Enhancement (should exist but doesn't). Within each group, order by dependency — if fix B depends on fix A, A comes first. For research-sourced fixes, include the documentation reference so the implementation engineer knows the correct pattern to follow.

**Step F: Present to user.** Show the defect log, the plan, and ask for sign-off before implementation.

---

## Phase 2: Implementation

Deploy the **Implementation Engineer** (using `agents/implementation-engineer.md`) with:
- The full defect log (with test case IDs for each defect)
- The approved remediation plan in priority order
- The technical architect's structural recommendations
- The **research notes** — especially for research-sourced defects, the engineer needs the documentation references to implement fixes using the correct documented patterns rather than guessing
- The **complete QA test matrix as acceptance criteria** — every fix must reference the specific test case IDs it resolves, and the engineer must self-validate each fix against those cases before moving on

For research-sourced fixes: the engineer must follow the documented pattern from the research notes, not invent their own approach.

Save to `tasks/review-{section}/phase-2/implementation/`.

### Splitting Large Implementations

If the remediation plan contains more than ~15 defects, split implementation across multiple agents to avoid context exhaustion:

1. **Split by severity tier** — Deploy one agent for Critical fixes, one for Structural, one for Enhancement. Critical goes first; the other two can run in parallel after Critical completes (in case Critical fixes change the approach for downstream fixes).
2. **Split by sub-domain** — If the defects cluster around distinct areas (e.g., payment defects vs communication defects), assign each cluster to a separate agent.
3. **Never split a dependency chain** — If fix B depends on fix A, both go to the same agent. Use the remediation plan's dependency ordering to determine which defects must stay together.

Each implementation agent gets only the defects, test cases, and research notes relevant to their assigned cluster — not the entire log.

---

## Phase 3: Validation

Deploy the **Validation Specialist** (using `agents/validation-specialist.md`) with:
- The original QA test matrix
- The full defect log
- The implementation changes log
- The research notes
- The technical architect's report

The Validation Specialist will:

1. Re-run the full test matrix against modified code
2. For every defect in the log, confirm the fix works by re-tracing the code
3. Check for regressions — trace adjacent flows that weren't directly modified
4. Validate that every multi-step operation now has proper failure handling
5. **Verify research-sourced fixes** — for every defect tagged `SOURCE: research`, confirm the implementation follows the documented pattern from the research notes
6. Produce a go/no-go with specific evidence for each decision

Save to `tasks/review-{section}/phase-3/validation/`.

If validation surfaces new issues: fix → validate → repeat, subject to these limits:

### Validation Loop Limits

- **Max 2 validation loops.** Loop 1: initial validation. Loop 2: re-validation after fixes from Loop 1.
- **After Loop 2**, if defects remain:
  - **Critical severity** (data loss, auth bypass, payment failure): Must fix — do a third targeted loop on Critical items only.
  - **High severity**: Can mark as "known limitation" if the fix requires refactoring estimated at >1 hour. Document in final report.
  - **Medium/Low severity**: Mark as "future work" — include in final report with recommended priority.
- **Escalation**: If Loop 2 finds >5 new defects not in the original log, STOP and present findings to the user. The original discovery may have missed a systemic issue that requires re-scoping.

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
tasks/review-{section}/
├── brief.md
├── phase-1/
│   ├── structural-mapper/report.md
│   ├── business-rules-auditor/report.md
│   ├── technical-architect/report.md
│   ├── qa-specialist/
│   │   ├── report.md
│   │   └── test-matrix.md
│   ├── research-notes.md
│   ├── consolidated-defect-log.md
│   └── remediation-plan.md
├── phase-2/
│   └── implementation/changes-log.md
├── phase-3/
│   └── validation/validation-report.md
└── final-report.md
```
