#!/usr/bin/env tsx

/**
 * Deprecated wrapper.
 *
 * This script previously attempted to call a Next.js server action (which is unsafe and often
 * runtime-broken in standalone scripts). It now delegates to the hardened admin-client variant.
 *
 * Usage is identical to `delete-test-customers-direct.ts`:
 * - Dry-run (default): tsx scripts/cleanup/delete-test-customers.ts
 * - Mutation: RUN_DELETE_TEST_CUSTOMERS_DIRECT_MUTATION=true ALLOW_DELETE_TEST_CUSTOMERS_DIRECT_MUTATION=true tsx scripts/cleanup/delete-test-customers.ts --confirm --limit 10
 */

import './delete-test-customers-direct'
