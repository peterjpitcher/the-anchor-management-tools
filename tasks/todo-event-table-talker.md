# Table talker media format: build plan

Spec: `tasks/spec-event-table-talker-2026-09-09.md` (approved 2026-09-10).
Worktree: `/Users/peterpitcher/Cursor/.worktrees/event-table-talker`, branch
`feat/event-table-talker`, cut from `origin/main` at `a766da03`. Scoped file,
not `tasks/todo.md`, because other sessions share this repository.

Complexity 4 (L): new variant, migration, new route. Delivered as ordered
commits, each green on its own. The migration must be applied to production
before the code that reads `table_talker_url` deploys.

## Ground rules

- No migration is applied to production without the owner's explicit yes.
- Stage explicit paths only. Never `git add -A`, never `--amend`.
- `sharp` and `pdf-lib` are imported dynamically in server code.
- No em dashes anywhere. British English.
- Gates per commit: `npm run lint`, `NODE_OPTIONS=--max-old-space-size=12288 npx tsc --noEmit`,
  `npm test`, `npm run test:utc`. Full `npm run build` before the branch is called done.

## Commits

- [ ] 1. docs: approved spec and this plan.
- [ ] 2. feat(db): migration `event_image_table_talker`, drafted and statically
      checked, NOT applied. Parity test: CHECK list, both RPC allow lists and the
      unique index predicate equal the variant config.
- [ ] 3. refactor(events): per print surface QR rules. `print` block on the
      variant config (poster only at this step), geometry takes a minimum,
      compositor passes it, `resolvePrintLink(eventId, channel)`,
      `isPrintVariant` from config, modal reads the print block. The poster
      behaves exactly as before.
- [ ] 4. feat(events): the `table_talker` variant, its prompt line and note,
      the cache column in types and selects, panel heading copy.
- [ ] 5. feat(events): the print sheet. Pure layout module, PDF builder, GET
      route, Print sheet button and dpi readout on the tile, downloads card.
- [ ] 6. Full gate including `npm run build`; browser check of the drawer if the
      preview can reach this worktree; say plainly if it cannot.

## After the owner says yes to the migration

- [ ] Apply via `npx supabase db push` after `--dry-run` lists only this file.
- [ ] Verify: CHECK, column, index predicate, both RPCs, grants
      (`has_function_privilege`), then `assert-anon-surface.ts`.
- [ ] Merge, confirm the production deployment is Ready and serving the commit.
- [ ] Owner prints, cuts and scans one sheet. Only then is this done.

## Results

(filled in as commits land)
