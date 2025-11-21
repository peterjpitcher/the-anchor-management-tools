# The Anchor Management Tools - GEMINI.md

## Project Overview

**The Anchor Management Tools** is a comprehensive venue management system designed for "The Anchor". It handles event scheduling, customer management, employee records, private bookings, and automated SMS notifications.

**Key Technologies:**
*   **Frontend:** Next.js 15.3.3 (App Router), React 19.1.0, TypeScript, Tailwind CSS.
*   **Backend:** Supabase (PostgreSQL, Auth, Storage, Edge Functions), Node.js 20.x.
*   **Integrations:** Twilio (SMS), Microsoft Graph API (Email), Puppeteer (PDF Generation).
*   **Architecture:** Serverless, utilizing Next.js Server Actions for all data mutations.

**Core Features:**
*   Event Management & Capacity Tracking.
*   Customer Database with SMS preferences.
*   Booking System (Event, Table, Car-park).
*   Automated SMS Reminders & Confirmations.
*   Employee Management & Private Bookings.
*   Role-Based Access Control (RBAC) & Row Level Security (RLS).

## Building and Running

**Prerequisites:**
*   Node.js 20.x
*   npm

**Setup:**
1.  **Install Dependencies:**
    ```bash
    npm install
    ```
2.  **Environment Configuration:**
    *   Copy `.env.example` to `.env.local`.
    *   Populate keys for Supabase, Twilio, Microsoft Graph, and Cron secrets.

**Commands:**

*   **Development Server:**
    ```bash
    npm run dev
    ```
    *Runs at http://localhost:3000*

*   **Production Build:**
    ```bash
    npm run build
    ```

*   **Start Production Server:**
    ```bash
    npm start
    ```

*   **Linting & Type Checking:**
    ```bash
    npm run lint
    ```

*   **Testing:**
    ```bash
    npm test
    ```
    *Runs Vitest.*

*   **Database Migrations:**
    ```bash
    npx supabase db push
    ```
    *(Requires Supabase CLI)*

*   **Utility Scripts:**
    Scripts are located in `scripts/`, run via `tsx`:
    ```bash
    tsx scripts/sms-tools/check-all-jobs.ts
    ```

## Development Conventions

### Architecture & Patterns
*   **Server Actions:** primarily used for all data mutations. **Do not** create API routes for internal data mutations.
    *   Pattern: `Validate Input -> Check Permissions -> DB Operation -> Log Audit -> Revalidate Cache`.
    *   Return format: `{ success: boolean, error?: string, data?: T }`.
*   **Supabase Client:** **Never** create new client instances manually. Use the provided singletons in `@/lib/supabase/`.
    *   Server Components/Actions: `createClient()` from `@/lib/supabase/server`.
    *   Client Components: `createClient()` from `@/lib/supabase/client`.
*   **Permissions:** Always verify permissions using `checkUserPermission(module, action)` before performing sensitive actions.
*   **State Management:** React Context is used for global state like Auth and Permissions.

### Code Style & Structure
*   **TypeScript:** Strict mode enabled. **No `any`**. Use `unknown` and narrow types if necessary.
*   **Imports:** Use absolute paths with `@/` alias (e.g., `@/components/ui/Button`).
    *   Order: External -> Internal Core (`@/lib`) -> Components -> Types -> Styles.
*   **Naming:**
    *   Files: `kebab-case` (e.g., `user-profile.tsx`).
    *   Components: `PascalCase` (e.g., `UserProfile`).
    *   Functions/Variables: `camelCase`.
    *   Constants: `UPPER_SNAKE_CASE`.
*   **Directory Structure:**
    *   `src/app/(authenticated)`: Protected routes.
    *   `src/actions`: Server actions.
    *   `src/lib`: Core business logic and utilities.
    *   `src/components/ui`: Reusable UI components.
    *   `docs/`: Comprehensive documentation.

### Operational
*   **Git:** Follow Conventional Commits (e.g., `feat: add new booking form`, `fix: resolve sms delivery issue`).
*   **Database:** Changes must be done via migrations in `supabase/migrations/`.
*   **New Features:** Verify with existing `docs/standards/` guidelines before implementation.
