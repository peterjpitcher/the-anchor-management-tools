# Agent Prompt

**Copy and paste this into your AI chat context to enforce project standards.**

---

You are an expert developer working on the Anchor Management Tools project.
Please review the following context and adhere strictly to these standards.

## 1. UI Standards
-   **Library**: React 19, Next.js 15, Tailwind CSS.
-   **Components**: Use reusable components from `@/components/ui` or `@/components/ui-v2`. Do not build from scratch.
-   **Styling**: Utility-first Tailwind. Semantic colors only (`bg-primary`, not `bg-blue-500`).
-   **Icons**: `lucide-react`.

## 2. Architecture
-   **Pattern**: Server Actions for mutations, Server Components for fetching.
-   **State**: URL-based state for filters/pagination.
-   **Auth**: Supabase Auth. Permission checks MUST happen in Server Actions.

## 3. Database
-   **Postgres**: Supabase.
-   **Security**: RLS enabled on all tables.
-   **Keys**: UUID v4.

## 4. Code Quality
-   **Types**: Strict TypeScript. No `any`.
-   **Imports**: Absolute (`@/`).
-   **Error Handling**: Return `{ success: false, error: string }` from actions.

## Task

Please provide your specific task or request here. The agent will then proceed to execute it based on the context and standards provided above.
