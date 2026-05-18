# Technology Stack

**Analysis Date:** 2026-05-18

## Languages

**Primary:**
- TypeScript 5.8 — all source files under `src/`; strict mode enabled

**Secondary:**
- SQL — Supabase migrations in `supabase/migrations/`

## Runtime

**Environment:**
- Node.js >=20 <23 (pinned to Node 20 LTS via `.nvmrc`)

**Package Manager:**
- npm (implicit — no lock file override)
- Lockfile: `package-lock.json` present

## Frameworks

**Core:**
- Next.js ^15.5.14 — App Router, React Server Components, API routes, cron handlers
- React ^19.1.0 — UI layer (Server and Client Components)

**Testing:**
- Vitest ^4.0.17 — test runner (config: `vitest.config.ts`)
- @testing-library/react ^16.0.1 — component testing
- @testing-library/user-event ^14.5.2 — user interaction simulation
- jsdom ^25.0.0 — DOM environment for Vitest

**Build/Dev:**
- TypeScript ^5.8.3 — type checking (`npx tsc --noEmit`)
- ESLint ^9.39.2 — linting (`eslint.config.js`); zero warnings enforced
- PostCSS `postcss.config.mjs` — Tailwind processing
- tsx ^4.21.0 — for running utility scripts directly (e.g., `scripts/`)
- patch-package ^8.0.1 — postinstall patches to `node_modules`

## Key Dependencies

**UI / Forms:**
- Tailwind CSS ^3.4.0 (config: `tailwind.config.js`) + tailwindcss-animate ^1.0.7
- tailwind-merge ^3.3.1 — merging class names without conflicts
- lucide-react ^0.522.0 — icon library
- @heroicons/react ^2.2.0 — additional icons
- @headlessui/react ^2.2.4 — accessible headless UI primitives
- react-hook-form ^7.66.1 + @hookform/resolvers ^5.2.2 — form management
- zod ^3.25.56 — schema validation
- react-hot-toast ^2.5.2 — toast notifications
- @dnd-kit/core, @dnd-kit/sortable, @dnd-kit/utilities — drag-and-drop (rota, menu)
- clsx ^2.1.1 — conditional class name utility

**Database / Auth:**
- @supabase/supabase-js ^2.55.0 — Supabase client (all DB operations)
- @supabase/ssr ^0.10.0 — cookie-based auth for Next.js SSR

**File Generation / Processing:**
- pdfkit ^0.18.0 — server-side PDF generation (invoices, contracts, payroll)
- pdf-lib ^1.17.1 — PDF manipulation
- pdf2json ^4.0.0 — PDF parsing
- pdfjs-dist ^5.4.530 — PDF rendering (browser)
- puppeteer ^24.12.1 + @sparticuz/chromium ^143.0.4 — headless browser PDF (quotes, invoices)
- @napi-rs/canvas ^0.1.88 — server-side canvas rendering
- sharp ^0.34.5 — image processing/compression
- exceljs ^4.4.0 — Excel export
- archiver ^7.0.1 — ZIP archive creation
- jszip ^3.10.1 — ZIP handling on client/server
- papaparse ^5.5.3 — CSV parsing
- mammoth ^1.11.0 — DOCX to HTML conversion

**External Service SDKs:**
- twilio ^5.10.6 — SMS sending and webhook validation
- openai ^6.15.0 — OpenAI API client (receipt classification)
- @microsoft/microsoft-graph-client ^3.0.7 — Microsoft Graph (email via Outlook)
- @azure/identity ^4.10.2 — Azure AD credential for Graph auth
- googleapis ^171.4.0 — Google Calendar API
- @paypal/react-paypal-js ^9.0.1 — PayPal JS SDK (client-side payment buttons)
- @vercel/functions ^3.4.3 — Vercel serverless function utilities

**Utilities:**
- date-fns ^4.1.0 + date-fns-tz ^3.2.0 — date manipulation (London timezone)
- libphonenumber-js ^1.12.37 — phone number normalisation to E.164
- qrcode ^1.5.4 — QR code generation (server + client)
- franc ^6.2.0 — language detection
- @zxing/browser + @zxing/library — barcode/QR scanning (timeclock kiosk)

## Configuration

**Environment:**
- Configured via `.env.local` (local) and Vercel environment variables (production)
- `.env.example` documents all required and optional vars
- Path alias: `@/*` → `./src/*` (tsconfig.json)

**Build:**
- `next.config.mjs` — Next.js configuration
- `postcss.config.mjs` — PostCSS/Tailwind pipeline
- `tailwind.config.js` — Tailwind theme (v3; NOT v4 inline theme)
- `vitest.config.ts` — test runner configuration
- `eslint.config.js` — ESLint flat config

## Platform Requirements

**Development:**
- Node 20 LTS (`.nvmrc` pins to `20`); run `nvm use` before development
- Supabase CLI (`supabase` devDependency ^2.58.5) for migrations

**Production:**
- Vercel (hosting + serverless functions + cron jobs)
- Supabase (PostgreSQL + Auth + RLS + Storage)
- Custom domains: `the-anchor.pub`, `vip-club.uk` (short links), `l.the-anchor.pub`

---

*Stack analysis: 2026-05-18*
