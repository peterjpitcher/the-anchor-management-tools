# Skill: Tech Debt Scanner

## When to use
Run at the end of every session, or when explicitly asked to scan for tech debt. Also trigger on "clean up", "tidy up the code", "what needs refactoring", or "find dead code".

## Instructions

1. Scan the recently modified files and their surrounding modules
2. Check for:
   - **Duplicated code**: Functions or blocks that do the same thing in multiple places
   - **Unused imports and exports**: Dead references that add noise
   - **Inconsistent patterns**: e.g., some files use server actions, others use API routes for the same kind of operation
   - **TODO/FIXME/HACK comments**: These are admitted debt — log each one
   - **Hardcoded values**: Magic numbers, hardcoded strings that should be constants or config
   - **Missing error handling**: Try/catch blocks that swallow errors, async operations with no error path
   - **Stale types**: TypeScript types that don't match actual data shapes
   - **Console.log left behind**: Debug logging that shouldn't ship
   - **Supabase queries without RLS consideration**: Data access that might bypass security
   - **Legacy patterns**: Old credit card hold references, deprecated API usage, outdated Supabase client patterns

3. For each finding, note: file, line, what's wrong, suggested fix, effort estimate (trivial/small/medium/large)
4. Sort by effort (trivial first) — quick wins get done, big items get planned

## Output format
Save to `tasks/techdebt-[date].md`:

```markdown
# Tech Debt Scan — [date]

## Quick Wins (trivial effort)
- [ ] file:line — description — fix

## Small Fixes
- [ ] file:line — description — fix

## Medium Refactors
- [ ] file:line — description — fix

## Larger Work
- [ ] description — scope — recommendation
```

## Common pitfalls
- Don't flag intentional patterns as debt (e.g., a deliberate denormalization)
- Don't suggest refactoring stable, working code just because it's not "modern" — focus on things that cause real problems
- Check `tasks/lessons.md` for any known exceptions before flagging
