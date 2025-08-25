#!/usr/bin/env tsx

/**
 * Script to clear template cache
 */

// Since the cache is in-memory and per-process, we can't clear it from a script
// But we can provide an API endpoint to clear it

console.log('⚠️  Template cache is in-memory and per-process in serverless environments.')
console.log('    Each function invocation has its own cache.')
console.log('    To force fresh template loading, you can:')
console.log('    1. Deploy a new version of the code')
console.log('    2. Wait for the cache TTL to expire (1 hour)')
console.log('    3. Add a cache-busting mechanism to the code')
console.log('')
console.log('💡  The issue might be that templates are being cached with null values.')
console.log('    Check the Vercel function logs for the debug output we added.')