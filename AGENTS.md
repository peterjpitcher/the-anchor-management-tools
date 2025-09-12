# Repository Guidelines

## Project Structure & Module Organization
- `src/app/`: Next.js App Router.
  - `(authenticated)/`: Protected routes.
  - `actions/`: Server actions for mutations.
  - `api/`: Route handlers (webhooks, cron).
- `src/components/`: Reusable UI.
- `src/lib/`: Core utilities (Supabase client, SMS, helpers).
- `src/contexts/`: React contexts (permissions).
- `src/types/`: Type definitions.
- `supabase/migrations/`: SQL migrations.
- `scripts/`: Operational tooling (e.g., `scripts/sms-tools/*`).
- `public/`: Static assets.

## Build, Test, and Development Commands
- `npm run dev`: Start local dev server at `http://localhost:3000`.
- `npm run build`: Production build.
- `npm start`: Start built app.
- `npm run lint`: ESLint checks.
- E2E tests: See `docs/TESTING.md` (Playwright). If scripts are absent, run `npx playwright test` from repo root.

## Coding Style & Naming Conventions
- Language: TypeScript (strict mode).
- Import alias: `@/*` maps to `src/*`.
- ESLint: Extends `next/core-web-vitals` and `next/typescript`.
  - Unused vars: prefix unused args with `_` to avoid warnings.
  - Avoid `any`; flagged as warn.
- Components: PascalCase filenames (e.g., `CustomerList.tsx`).
- Server actions: Place in `src/app/actions/*`, use clear verb-first names (e.g., `createBooking.ts`).
- Formatting: Follow existing style (2-space indentation, Tailwind utility-first).

## Testing Guidelines
- Framework: Playwright E2E (see `docs/TESTING.md`).
- Location: `tests/` (spec files use `.spec.ts`).
- Conventions: `describe()` suites, test names start with “should …”.
- Example: `npx playwright test tests/table-bookings.spec.ts`.

## Commit & Pull Request Guidelines
- Commits: Conventional Commits (e.g., `feat: add booking export`), small and focused.
- PRs: Provide clear description, link related issues, and include:
  - What/why summary and testing notes.
  - Screenshots for UI changes.
  - Any migration or ops steps (e.g., Supabase changes).

## Security & Configuration Tips
- Env: Copy `.env.example` to `.env.local`. Never commit secrets.
- Access control: Always check permissions (`checkUserPermission()`); log sensitive actions (`logAuditEvent()`).
- Phone numbers: Normalize to E.164 (`+44…`).
- Migrations: Place SQL in `supabase/migrations/` (`YYYYMMDDHHMMSS_description.sql`).

