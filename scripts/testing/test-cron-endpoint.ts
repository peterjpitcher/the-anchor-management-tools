import dotenv from 'dotenv'
import path from 'path'

// Load environment variables
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

async function parseJsonSafe(response: Response): Promise<unknown> {
  try {
    return await response.json()
  } catch {
    return await response.text().catch(() => null)
  }
}

async function testCronEndpoint() {
  console.log('Testing cron endpoint health check (read-only)\n')

  const cronSecret = process.env.CRON_SECRET
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'

  if (!cronSecret) {
    throw new Error('CRON_SECRET not found in environment variables')
  }

  console.log(`Target: ${appUrl}`)
  console.log(`CRON_SECRET: ${cronSecret ? '✅ Set' : '❌ Missing'}\n`)

  // Read-only: do NOT call POST /api/jobs/process from scripts. It can process jobs and
  // trigger outbound side effects (SMS/email). Use the gated `scripts/process-jobs.ts`
  // workflow instead.
  const healthUrl = `${appUrl}/api/jobs/process?health=true`
  console.log(`Health check: ${healthUrl}`)

  const healthResponse = await fetch(healthUrl, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${cronSecret}`
    }
  })

  const healthData = await parseJsonSafe(healthResponse)
  console.log(`Health status: ${healthResponse.status} ${healthResponse.statusText}`)
  console.log('Health response:', JSON.stringify(healthData, null, 2))

  if (!healthResponse.ok) {
    throw new Error(`Health check failed (${healthResponse.status})`)
  }

  console.log('\nSanity check: health endpoint must reject missing auth')
  const unauthResponse = await fetch(healthUrl, { method: 'GET' })
  console.log(`Unauth status: ${unauthResponse.status} ${unauthResponse.statusText}`)
  if (unauthResponse.status < 400) {
    throw new Error('Health endpoint unexpectedly allowed unauthenticated access')
  }

  console.log('\n✅ Cron endpoint health check is working correctly.')
}

testCronEndpoint().catch((error) => {
  console.error('Fatal error:', error)
  process.exitCode = 1
})
