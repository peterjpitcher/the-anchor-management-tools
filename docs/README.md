# Documentation Index

Use this index to find the canonical documentation for The Anchor Management Tools. Each guide is actively maintained and reflects the current state of the codebase.

## Core Reference
- [Architecture](./ARCHITECTURE.md) – overall system design, data flow, and technology stack.
- [Features](./FEATURES.md) – functional overview of every major module.
- [Security](./SECURITY.md) – RBAC, auth hardening, compliance, and operational safeguards.

## Development Workflow
- [Contributing](./CONTRIBUTING.md) – project structure, coding standards, branch strategy, and PR expectations.
- [Testing](./TESTING.md) – current automated test status, manual smoke checks, and how to add new coverage.

## Operations & Support
- [Deployment](./DEPLOYMENT.md) – environment configuration, release workflow, and monitoring checklist.
- [Troubleshooting](./TROUBLESHOOTING.md) – quick diagnostics for auth, database, SMS, and build issues.
- [SMS Reminder Pipeline](./sms-reminder-pipeline.md) – single-source reference for the event reminder scheduler.
- **Setup guides** (`/setup/`):
  - [GitHub secrets](./setup/GITHUB_SECRETS_SETUP.md)
  - [Invoice system](./setup/INVOICE_SYSTEM_SETUP.md)
  - [Migration summary](./setup/MIGRATION_SUMMARY.md)
- **Operational guides** (`/guides/`):
  - [Monitoring setup](./guides/monitoring-setup.md)
- [Rate limiting](./guides/rate-limiting-implementation.md)
- [Layout migration](./guides/layout-migration.md)

## API Documentation
- [API overview](./guides/api/API_README.md) – authentication, rate limits, and key endpoints.
- [OpenAPI specification](./guides/api/openapi.yaml) – import into Swagger/Postman for detailed schemas.

## Additional Reference
- [Auth email templates](./auth-email-templates.md)
- [Auth setup overview](./auth-setup-overview.md)
