/**
 * Neutralise Next.js's `server-only` guard for tsx scripts.
 *
 * Importing app code that reaches a module marked `server-only` throws
 * "This module cannot be imported from a Client Component module" under plain
 * Node, because the guard assumes a Next.js build is resolving it. A tsx script
 * is already server-side with the service-role key, so the guard has nothing to
 * protect here and swapping it for an empty module is safe.
 *
 * Never wire this into the app itself. It exists so one-off scripts can reuse
 * services such as EventBookingService instead of hand-rolling their own SQL and
 * quietly skipping the side effects those services own (SMS, tokens, analytics).
 *
 * Usage:
 *   npx tsx --require ./scripts/server-only-stub.cjs scripts/your-script.ts
 */
const Module = require('module')

const originalResolveFilename = Module._resolveFilename
Module._resolveFilename = function (request, ...args) {
  if (request === 'server-only') {
    return require.resolve('./server-only-empty.cjs')
  }
  return originalResolveFilename.call(this, request, ...args)
}
