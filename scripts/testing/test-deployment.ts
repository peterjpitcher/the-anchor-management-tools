#!/usr/bin/env tsx
/**
 * Deployment status diagnostics (read-only).
 *
 * Safety:
 * - Performs GET requests only.
 * - Fails closed (non-zero exit) on connectivity failures.
 */

import dotenv from 'dotenv'
import path from 'path'

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

const SCRIPT_NAME = 'test-deployment'
const DEFAULT_URL = 'https://management.orangejelly.co.uk'

function findFlagValue(argv: string[], flag: string): string | null {
  const eq = argv.find((arg) => arg.startsWith(`${flag}=`))
  if (eq) return eq.split('=')[1] ?? null

  const idx = argv.indexOf(flag)
  if (idx === -1) return null

  const value = argv[idx + 1]
  return typeof value === 'string' && value.length > 0 ? value : null
}

function normalizeBaseUrl(value: string): string {
  const trimmed = value.trim().replace(/\/+$/, '')
  if (!trimmed) {
    throw new Error(`[${SCRIPT_NAME}] Invalid base URL`)
  }
  return trimmed
}

async function run(): Promise<void> {
  const argv = process.argv.slice(2)
  if (argv.includes('--confirm')) {
    throw new Error(`[${SCRIPT_NAME}] This script is read-only and does not support --confirm`)
  }

  const baseUrl = normalizeBaseUrl(findFlagValue(argv, '--url') ?? process.env.TEST_DEPLOYMENT_URL ?? DEFAULT_URL)

  console.log(`[${SCRIPT_NAME}] starting (read-only)\n`)
  console.log(`Base URL: ${baseUrl}\n`)

  console.log('1) Testing site availability...')
  let response: Response
  try {
    response = await fetch(baseUrl, { method: 'GET' })
  } catch (error) {
    throw new Error(`Site unavailable: ${error instanceof Error ? error.message : String(error)}`)
  }

  console.log(`OK Site responded (status ${response.status})`)

  console.log('\n2) Testing /api/health (if present)...')
  try {
    const health = await fetch(`${baseUrl}/api/health`, { method: 'GET' })
    if (health.status === 404) {
      console.log('WARN No health endpoint found (404)')
    } else {
      console.log(`OK /api/health responded (status ${health.status})`)
    }
  } catch (error) {
    console.error(`FAIL /api/health request failed: ${error instanceof Error ? error.message : String(error)}`)
    process.exitCode = 1
  }

  console.log('\n3) Deployment headers (if present)...')
  const headers = response.headers
  const deploymentUrl = headers.get('x-vercel-deployment-url')
  const vercelId = headers.get('x-vercel-id')
  const ageSeconds = Number(headers.get('age') || '0')

  console.log(`- x-vercel-deployment-url: ${deploymentUrl || 'N/A'}`)
  console.log(`- x-vercel-id: ${vercelId || 'N/A'}`)
  console.log(`- age: ${Number.isFinite(ageSeconds) ? ageSeconds : 'N/A'}s`)

  console.log('\n4) Manual verification notes...')
  console.log('- Confirm the latest deployment is Ready in Vercel, and that the expected code changes are present.')
  console.log('- For incident-related changes, validate logs/metrics for no duplicate or unlogged sends.')

  console.log(`\n✅ [${SCRIPT_NAME}] completed.`)
}

run().catch((error) => {
  console.error('Fatal error:', error)
  process.exitCode = 1
})

