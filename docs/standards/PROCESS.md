# Process Standards

## Development Workflow
1.  **Branching**:
    -   `main`: Production-ready code.
    -   `feat/name`: New features.
    -   `fix/name`: Bug fixes.
2.  **Commits**: Conventional Commits (`feat:`, `fix:`, `chore:`).
3.  **Pull Requests**:
    -   Must pass CI (Linting, Build).
    -   Must have a description.
    -   Review required before merge.

## Testing
-   **Unit**: Vitest for logic/helpers.
-   **E2E**: Playwright for critical user flows.
-   **Requirement**: New features must include tests (or at least a plan for testing).

## Documentation
-   **Update**: If you change logic, update the relevant docs.
-   **New Features**: Add a section to `FEATURES.md` or create a new guide if complex.

## Deployment
-   **Platform**: Vercel.
-   **Env Vars**: Never commit secrets. Add to Vercel dashboard and local `.env`.
-   **Migrations**: Run against production DB only via CI/CD or controlled manual process.

## Review Checklist (Agent Instructions)
-   [ ] Do the commit messages follow conventional format?
-   [ ] Are tests included or updated?
-   [ ] Is documentation updated?
