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

## Development Standards
We enforce strict development standards for UI, Code Quality, Database, and Architecture.
**Before writing any code, please read the [Standards Documentation](./standards/README.md).**

- **[UI & UX](./standards/UI_UX.md)**: Component usage and styling rules.
- **[Database](./standards/DATABASE.md)**: Schema and RLS guidelines.
- **[Code Quality](./standards/CODE_QUALITY.md)**: TypeScript and formatting.
- **[Architecture](./standards/ARCHITECTURE.md)**: Server Actions and data flow.
- **[Process](./standards/PROCESS.md)**: Testing and Deployment workflows.

## Support
- Production issues should be logged through the `/bug-report` API or the in-app bug reporter to maintain audit trails.
- Use the existing logging (`src/lib/logger.ts`) and monitoring hooks (see [docs/DEPLOYMENT.md](./DEPLOYMENT.md)) to trace incidents before escalating.
