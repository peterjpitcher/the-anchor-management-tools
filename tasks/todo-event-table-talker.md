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

- [x] 1. docs: approved spec and this plan. (`58bb2f32`)
- [x] 2. feat(db): migration `20260910100000_event_image_table_talker`, NOT
      applied. Proved on a throwaway local Postgres with the real RPC bodies,
      under the production ACL and a hostile one; re-runs as a no-op; its
      assertion rejects a copy with the index left narrow. (`672f6ccf`)
- [x] 3. refactor(events): per print surface QR rules. (`da3ae0d0`) `print` block on the
      variant config (poster only at this step), geometry takes a minimum,
      compositor passes it, `resolvePrintLink(eventId, channel)`,
      `isPrintVariant` from config, modal reads the print block. The poster
      behaves exactly as before.
- [x] 4. feat(events): the `table_talker` variant, its prompt line and note,
      the cache column in types and selects, panel heading copy, and the
      migration parity test (fails 6 of 7 with the migration removed). (`2cd0a677`)
- [x] 5. feat(events): the print sheet. Pure layout module, PDF builder, GET
      route, Print sheet button and dpi readout on the tile, downloads card. (`cab52fb7`)
- [ ] 6. Full gate including `npm run build`; browser check of the drawer if the
      preview can reach this worktree; say plainly if it cannot.

## After the owner says yes to the migration

- [ ] Apply via `npx supabase db push` after `--dry-run` lists only this file.
- [ ] Verify: CHECK, column, index predicate, both RPCs, grants
      (`has_function_privilege`), then `assert-anon-surface.ts`.
- [ ] Merge, confirm the production deployment is Ready and serving the commit.
- [ ] Owner prints, cuts and scans one sheet. Only then is this done.

## Results

- Full suite green in both zones: 779 files, 7070 passed, 2 skipped, London
  and UTC. Whole-repo lint and `tsc --noEmit` clean.
- A test sheet built through the real compositor and sheet builder renders as
  designed: panel 92.32 x 195.86 mm, 321.6 dpi from 1169 px, QR at the floor
  prints 15.0 mm, PDF 131 KB with the image embedded once.
- Not verified in a browser: the dev server talks to production, where
  `table_talker_url` does not exist until the migration is applied, so the
  artwork panel cannot load there before then. Component tests cover the UI.
