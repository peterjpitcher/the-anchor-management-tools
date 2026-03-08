# Skill: Autonomous Bug Fix

## When to use
When given a bug report, a failing test, an error message, a Vercel deployment failure, a Slack thread about something broken, or just "this is broken, fix it." Also trigger on "fix", "broken", "not working", "error", or when pointed at logs.

## Instructions

Zero hand-holding protocol. The user reports a problem, you fix it.

### 1. Investigate (don't ask, just look)
- Read the error message / bug report / logs carefully
- Find the relevant code files — use grep, glob, follow imports
- Check Supabase schema if the issue involves data
- Check Stripe integration if the issue involves payments
- Check server actions and API routes for the affected flow
- Read `tasks/lessons.md` — has this pattern been seen before?

### 2. Identify root cause
- Trace the code path that leads to the bug
- Don't stop at the symptom — find the actual root cause
- Check if the same pattern exists elsewhere (bugs cluster)
- Verify your hypothesis by tracing the logic, not guessing

### 3. Fix it
- Write the fix for the root cause, not just the symptom
- Handle edge cases the original code missed
- Add or improve error handling if the bug was a silent failure
- Update TypeScript types if the bug was a type mismatch
- Fix any related instances of the same pattern

### 4. Verify
- Trace the fixed code path to confirm it works
- Check that the fix doesn't break adjacent flows
- If there are tests, run them
- If there are no tests for this code path, consider adding one
- Check that the fix handles the edge cases that caused the original bug

### 5. Report
Brief summary of what was wrong, what you did, and what to watch for.

## Output format

```markdown
## Bug Fix: [one-line description]

**Root cause**: [what was actually wrong and why]
**Fix**: [what you changed]
**Files modified**: [list]
**Verification**: [how you confirmed it works]
**Related risks**: [anything adjacent that should be checked]
```

## Common pitfalls
- Don't ask "can you share the error?" — go find the error yourself
- Don't patch the symptom and call it done — find the root cause
- Don't forget to check if the same bug exists in similar code paths
- Don't skip Supabase RLS checks when modifying data access
- Update `tasks/lessons.md` after fixing so the pattern is captured
