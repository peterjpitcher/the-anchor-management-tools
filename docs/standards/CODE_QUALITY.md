# Code Quality & Style Standards

## Core Principles
1.  **Type Safety**: TypeScript Strict Mode is enabled. No `any`.
2.  **Clarity**: Code should be self-documenting. Comments explain "why", not "what".
3.  **Modularity**: Functions should be small and single-purpose.

## TypeScript
-   **Strict Mode**: Enabled.
-   **Types vs Interfaces**: Use `interface` for object definitions, `type` for unions/intersections.
-   **Exports**: Named exports preferred over default exports (except for Next.js pages/layouts).
-   **No `any`**: Use `unknown` if type is truly dynamic, then narrow it.

## Error Handling
-   **Server Actions**: Return a standardized result object `{ success: boolean, error?: string, data?: T }`.
-   **Try/Catch**: Wrap potentially failing operations (DB calls, external APIs).
-   **Logging**: Log errors to the server-side logger, not just `console.error`.

## Imports
-   **Absolute Paths**: Use `@/` alias for internal imports.
-   **Order**:
    1.  External libraries (React, Next.js, etc.)
    2.  Internal core (`@/lib`, `@/hooks`)
    3.  Components (`@/components`)
    4.  Types/Utils (`@/types`)
    5.  Styles

## Naming Conventions
-   **Files**: kebab-case (e.g., `user-profile.tsx`, `validation-utils.ts`).
-   **Components**: PascalCase (e.g., `UserProfile`).
-   **Functions/Variables**: camelCase.
-   **Constants**: UPPER_SNAKE_CASE.
-   **Booleans**: Prefix with `is`, `has`, `should` (e.g., `isLoading`, `hasPermission`).

## Review Checklist (Agent Instructions)
-   [ ] Are there any `any` types used?
-   [ ] Are imports using absolute paths (`@/...`)?
-   [ ] are functions handling errors gracefully?
-   [ ] Is the code formatted (Prettier)?
