# Database Standards

## Core Principles
1.  **Security First**: RLS (Row Level Security) is mandatory for ALL tables.
2.  **Data Integrity**: Use foreign key constraints and non-nullable fields where appropriate.
3.  **Performance**: Index foreign keys and frequently queried fields.

## Schema Design
-   **Primary Keys**: Must be `UUID` v4.
-   **Timestamps**: All tables must have `created_at` and `updated_at` (timestamptz).
-   **Naming Convention**: snake_case for all table names and columns.
    -   Tables: Plural (e.g., `customers`, `bookings`).
    -   Foreign Keys: Singular + `_id` (e.g., `customer_id`).
    -   Junction Tables: `table1_table2` (e.g., `users_roles`).

## Row Level Security (RLS)
-   **Default**: Enable RLS on all tables immediately upon creation.
-   **Policies**: Define granular policies for `SELECT`, `INSERT`, `UPDATE`, `DELETE`.
-   **Helper Functions**: Use `user_has_permission()` for complex checks.

## Migrations
-   **Tool**: Supabase CLI.
-   **Location**: `supabase/migrations/`.
-   **Naming**: `YYYYMMDDHHMMSS_description.sql`.
-   **Content**: Pure SQL. Must be reversible (though down migrations are rarely used in dev, the logic should be sound).
-   **Safety**: Never drop columns or tables without a backup/migration strategy documented.

## Querying (Application Side)
-   **Client**: Use the centralized `createClient()` from `src/lib/supabase/server.ts` (Server Actions) or `client.ts` (Client Components).
-   **Types**: Auto-generate Typescript types from the schema.
-   **Selects**: Be specific. Avoid `select('*')` in critical paths; select only needed fields.

## Review Checklist (Agent Instructions)
-   [ ] Does the new table have RLS enabled?
-   [ ] Are appropriate indexes added for foreign keys?
-   [ ] Are table/column names in snake_case?
-   [ ] Is there a `created_at` timestamp?
