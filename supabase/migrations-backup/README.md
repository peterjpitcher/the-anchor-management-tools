# Migration Backup

This directory contains all the individual migration files that have been squashed into a single comprehensive baseline migration.

## What was done:

1. All 30+ individual migrations were analyzed and consolidated
2. A new complete baseline migration was created at: `../migrations/20240625000000_complete_baseline.sql`
3. All old migration files were moved here for backup purposes

## The new baseline includes:

- Complete table structures with all modifications from subsequent migrations
- All indexes for performance optimization
- All functions, triggers, and views
- All RLS policies
- Initial data for RBAC, event categories, loyalty tiers, etc.
- Proper permissions and grants

## When to use these files:

These backup files should only be needed if:
- You need to understand the historical evolution of the schema
- You need to debug a specific migration issue
- You need to reference what changed between versions

## Important:

**DO NOT** run these migrations - they have all been incorporated into the complete baseline.
The database should be initialized using only the baseline migration.

## Migration History:

1. Initial baseline and production schema
2. Loyalty system implementation (8 migrations)
3. Rate limiting
4. Short links with analytics (6 migrations with fixes)
5. Pending bookings for API integration (7 migrations)
6. Table booking system (5 migrations)
7. Critical infrastructure (jobs table and performance indexes)

Created: 2025-07-19