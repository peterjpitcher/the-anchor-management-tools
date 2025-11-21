# Architecture Standards

## Core Principles
1.  **Server-First**: Prefer Server Components and Server Actions over Client Components and API Routes.
2.  **Separation of Concerns**: UI components do not contain business logic. Business logic lives in **Service Classes** (not Server Actions directly).
3.  **Security**: Never trust client input. Validate everything on the server.
4.  **Atomicity**: Multi-step database operations must be wrapped in atomic transactions.

## Service Layer Pattern (NEW 2025)
To avoid "Thick Server Actions" and inconsistent logic, we enforce a **Service Layer** architecture.

### 1. Server Actions (`src/app/actions/`)
**Role:** Controller / Interface
-   **DO**:
    -   Check Permissions (RBAC).
    -   Validate Input (Zod parsing).
    -   Call Service methods.
    -   Manage Side Effects (Queue background jobs, Revalidate Path).
    -   Handle HTTP-level errors/redirects.
-   **DO NOT**:
    -   Contain direct database queries (except simple reads for UI hydration).
    -   Contain complex business rules.
    -   Perform synchronous 3rd-party API calls (SMS/Email) that block the UI.

### 2. Service Layer (`src/services/`)
**Role:** Business Logic & Data Access
-   **Structure**: Static classes or exported functions (e.g., `TableBookingService`, `EventService`).
-   **DO**:
    -   Encapsulate all business rules (e.g., "Is kitchen open?", "Is booking capacity exceeded?").
    -   Perform database operations (CRUD).
    -   Use **Atomic Transactions** (RPC functions) for multi-table writes.
    -   Trigger lightweight side effects (e.g., generating slugs).
-   **Pattern**:
    ```typescript
    // src/services/booking.ts
    export class BookingService {
      static async create(input: CreateInput) {
        // 1. Validate Rules
        if (!this.isOpen(input.date)) throw new Error("Closed");
        
        // 2. Atomic DB Operation
        const { data, error } = await supabase.rpc('create_booking_txn', input);
        if (error) throw error;
        
        return data;
      }
    }
    ```

### 3. Database Transactions (`supabase/migrations/`)
**Role:** Data Integrity
-   Use PostgreSQL Functions (`RPC`) for operations affecting multiple tables (e.g., `Booking` + `BookingItems` + `Payment`).
-   Ensures that if one part fails, the entire operation rolls back.

### 4. Background Jobs (`src/lib/background-jobs.ts`)
**Role:** Async Processing
-   Offload slow tasks (Email, SMS, heavy calculations) to the `jobs` table.
-   Use GitHub Actions (Cron) to process the queue.

---

## Project Structure
-   `src/app`: Routing and Page layouts (Server Components).
-   `src/components`: Presentational components.
-   `src/services`: **(NEW)** Business logic layer.
-   `src/lib`: Shared utilities (Date formatting, API clients).
-   `src/actions`: Server Actions (Thin controllers).

## Data Fetching
-   **Server Components**: Fetch data directly using Supabase client (Read-only).
-   **Mutations**: Use Server Actions -> Service Layer.

## Permissions (RBAC)
-   **Check Location**: Must check permissions in **Server Actions** before calling the Service.

## Review Checklist (Agent Instructions)
-   [ ] Are Server Actions "thin" (delegating logic)?
-   [ ] Is business logic encapsulated in `src/services/`?
-   [ ] Are complex writes using Atomic Transactions (RPC)?
-   [ ] Are slow operations (SMS/Email) queued in `jobs`?