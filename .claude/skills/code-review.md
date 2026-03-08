# Skill: Code Review

## When to use
When asked to review changes, review a PR, "grill me on this", or before merging any significant work. Also use when the user says "review this before I push" or "is this ready for production".

## Instructions

Act as a senior staff engineer reviewing a junior's PR. Be rigorous but constructive.

### 1. Understand the change
- Read the diff (or changed files) thoroughly
- Understand the intent: what problem is being solved?
- Check if the approach matches the intent

### 2. Check correctness
- Trace every code path, including error paths
- For database operations: are queries correct? Are RLS policies respected? Are there race conditions?
- For Stripe operations: is idempotency handled? Are amounts in the right units? Are webhooks robust?
- For Supabase operations: are types matching the actual schema? Are nullable fields handled?
- For UI changes: does the component handle loading, error, and empty states?

### 3. Check edge cases
- What happens with null/undefined inputs?
- What happens at boundaries (0, 1, max values)?
- What happens with concurrent operations?
- What happens when external services are down?
- What happens with stale data?

### 4. Check for regressions
- Do the changes break any existing flows?
- Are there dependent components or pages that need updating?
- Does the change affect any shared utilities?

### 5. Check quality
- Is the code readable and maintainable?
- Are TypeScript types accurate (no `any` cheats)?
- Is error handling specific and useful?
- Are there adequate comments for non-obvious logic?
- Does it follow the project's existing patterns?

### 6. Diff against main
If possible, compare behaviour between main and the feature branch for the affected flows.

## Output format

```markdown
## Code Review

### Summary
[One-line verdict: approve / request changes / needs discussion]

### Critical Issues (must fix)
- [ ] issue — why it matters — suggested fix

### Suggestions (should fix)
- [ ] issue — why it matters — suggested fix

### Nits (optional)
- [ ] issue

### What's good
[Acknowledge what was done well]
```

## Common pitfalls
- Don't bikeshed on style when there are real bugs
- Don't approve just because the code "looks fine" — trace the logic
- Don't skip checking Supabase RLS implications for data access changes
- Check `tasks/lessons.md` for recurring issues to watch for
