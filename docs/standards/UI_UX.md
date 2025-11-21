# UI & UX Standards

## Core Principles
1.  **Reusability First**: Never build a UI element from scratch if a component exists in `src/components/ui` or `src/components/ui-v2`.
2.  **Consistency**: All pages must follow the layout defined in the main application shell.
3.  **Accessibility**: All interactive elements must be keyboard navigable and have aria-labels where necessary.
4.  **Mobile-First**: Designs must be responsive and function on mobile devices.

## Component Usage
-   **Path**: `src/components/ui` (Legacy), `src/components/ui-v2` (New). Prefer V2.
-   **Imports**: Import components directly from their index files.
    ```typescript
    import { Button } from '@/components/ui-v2/button'; // Correct
    import Button from '@/components/ui-v2/button/Button'; // Incorrect
    ```

## Styling (Tailwind CSS)
-   **Utility-First**: Use Tailwind utility classes for all styling. Avoid custom CSS files or `style` tags.
-   **Colors**: Use semantic color names defined in `tailwind.config.js` (e.g., `bg-primary`, `text-destructive`) rather than raw hex codes or standard colors (e.g., `bg-red-500`).
-   **Spacing**: Use standard Tailwind spacing scale (1, 2, 4, 8, etc.).
-   **Dark Mode**: Ensure all components support dark mode variants (`dark:bg-slate-900`).

## Layouts
-   **Page Structure**:
    ```tsx
    export default function Page() {
      return (
        <PageContainer>
          <PageHeader title="Page Title" actions={<PageActions />} />
          <PageContent>
            {/* Content */}
          </PageContent>
        </PageContainer>
      );
    }
    ```

## Forms
-   **Library**: Use `react-hook-form` combined with `zod` for validation.
-   **Components**: Use `Form`, `FormField`, `FormItem`, `FormLabel`, `FormControl`, `FormMessage` wrappers.
-   **Validation**: Define schemas in a separate file or collocated if small.

## Icons
-   **Libraries**: `lucide-react` (preferred) or `@heroicons/react`.
-   **Size**: standard sizes (w-4 h-4, w-5 h-5).

## Review Checklist (Agent Instructions)
-   [ ] Are there any hardcoded hex colors? (Flag as error)
-   [ ] Are standard UI components used instead of raw HTML elements (e.g., `Button` vs `<button>`)?
-   [ ] Is the layout responsive?
-   [ ] Are form inputs validated with Zod?
