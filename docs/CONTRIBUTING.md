# Contributing Guide

Thank you for helping improve The Anchor Management Tools. This guide covers the practical workflow, expectations, and coding standards used across the project.

## Getting Started
- **Node.js**: use v20.x (enforced via `package.json` engines).
- **Install dependencies**: `npm install`.
- **Environment**: copy `.env.example` to `.env.local` and populate Supabase, Twilio, Microsoft Graph, and CRON secrets before running the app.
- **Local dev**: `npm run dev` serves the app at `http://localhost:3000`.
- **Lint/typecheck**: `npm run lint` (runs Next.js ESLint config with TypeScript type checking).

When working on Supabase features, link the CLI and apply migrations with `supabase db push`. Do not edit the placeholder migrations in `supabase/migrations/` unless you are coordinating with the data team.

## Branching & Commits
- Create feature branches from `main` using the format `feat/short-description` or `fix/short-description`.
- Follow [Conventional Commits](https://www.conventionalcommits.org/) for commit messages (`feat:`, `fix:`, `chore:`, `docs:` etc.).
- Keep pull requests focused; include a clear “what/why” summary, test notes, and screenshots for UI changes.
- Reference any related issues in the pull request description.

## Project Structure
- `src/app/` – Next.js App Router. Server actions live in `actions/`; protected routes live under `(authenticated)/`; API route handlers live in `api/`.
- `src/components/` – Reusable UI (PascalCase filenames). Shared form elements and UI primitives live in `components/ui` and `components/ui-v2`.
- `src/lib/` – Core utilities (Supabase client, SMS, PDF generation, helpers). Avoid creating duplicate clients; reuse the provided factories.
- `src/contexts/` – React providers for auth and permissions.
- `src/types/` – Shared TypeScript definitions.
- `supabase/migrations/` – SQL migrations synced with production. Create new migrations using the Supabase CLI and the `YYYYMMDDHHMMSS_description.sql` naming convention.
- `scripts/` – Operational scripts; active SMS tooling is in `scripts/sms-tools/`.

## Coding Standards
- **TypeScript**: strict mode; avoid `any`. Prefer explicit interfaces and discriminated unions. Prefix unused parameters with `_` to satisfy ESLint.
- **Server actions**: every mutation should reside in `src/app/actions/`; always call `checkUserPermission()` before mutating data and `logAuditEvent()` for sensitive operations.
- **Supabase**: use the shared clients from `src/lib/supabase/*`. Never instantiate a raw client inside React components.
- **Phone numbers**: normalise to E.164 (`+44…`) before storage; utilities exist in `src/lib/validation.ts`.
- **Error handling**: surface actionable error messages and log the full error server-side using the shared logger.

## UI & Styling
- Components follow Tailwind’s utility-first approach and 2-space indentation.
- Keep components small and composable; colocate feature-specific UI under its module (e.g., `src/app/(authenticated)/events/components/`).
- Use the design tokens defined in `src/components/ui-v2/tokens.ts` when building new UI in the v2 library.
- For icons, rely on Heroicons or Lucide; avoid adding new icon packs.

## Testing & QA
- There are currently no automated Playwright tests checked into the repo. Before opening a PR:
  - Run `npm run lint`.
  - Build the app with `npm run build`.
  - Manually smoke-test the flow you touched (log in, execute the affected feature, verify audit logs and SMS behaviour where relevant).
- If you add new automated tests, place Playwright specs under `tests/` and keep suites focused on critical paths (auth, bookings, invoicing). Update [docs/TESTING.md](./TESTING.md) with new commands or fixtures.

## Documentation Expectations
- Update documentation when behaviour, API signatures, environment variables, or operational steps change.
- Reference the canonical docs in `docs/` rather than creating ad-hoc files. If you must add new material, link it from `docs/README.md`.
- For security-sensitive changes, capture the impact in [docs/SECURITY.md](./SECURITY.md) or the relevant compliance guide.

## Support
- Production issues should be logged through the `/bug-report` API or the in-app bug reporter to maintain audit trails.
- Use the existing logging (`src/lib/logger.ts`) and monitoring hooks (see [docs/DEPLOYMENT.md](./DEPLOYMENT.md)) to trace incidents before escalating.
