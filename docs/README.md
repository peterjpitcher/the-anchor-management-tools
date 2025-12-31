# Documentation Index

Use this index to find the canonical documentation for The Anchor Management Tools. Each guide is actively maintained and reflects the current state of the codebase.

## Core Reference
- **[Development Standards](./standards/README.md)** – **START HERE.** The single source of truth for UI, DB, and Code standards.
- [Architecture](./ARCHITECTURE.md) – overall system design, data flow, and technology stack.
- [Features](./FEATURES.md) – functional overview of every major module.
- [Security](./SECURITY.md) – RBAC, auth hardening, compliance, and operational safeguards.

## Plans & Proposals
- [Hiring workflow requirements](./plans/hiring-workflow.md) – jobs, candidates, and hiring workflow requirements with discovery notes.

## Development Workflow
- [Contributing](./CONTRIBUTING.md) – project structure, coding standards, branch strategy, and PR expectations.
- [Testing](./TESTING.md) – current automated test status, manual smoke checks, and how to add new coverage.

## Operations & Support
- [Deployment](./DEPLOYMENT.md) – environment configuration, release workflow, and monitoring checklist.
- [Troubleshooting](./TROUBLESHOOTING.md) – quick diagnostics for auth, database, SMS, and build issues.
- **Setup guides** (`/setup/`):
  - [GitHub secrets](./setup/GITHUB_SECRETS_SETUP.md)
- **Operational guides** (`/guides/`):
  - [Monitoring setup](./guides/monitoring-setup.md)
- [Rate limiting](./guides/rate-limiting-implementation.md)

## API Documentation
- [API overview](./guides/api/API_README.md) – authentication, rate limits, and key endpoints.
- [OpenAPI specification](./guides/api/openapi.yaml) – import into Swagger/Postman for detailed schemas.
