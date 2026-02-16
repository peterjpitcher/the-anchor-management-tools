#!/usr/bin/env tsx

import * as fs from 'fs'
import * as path from 'path'
import { config } from 'dotenv'

function hasFlag(flag: string): boolean {
  return process.argv.includes(flag)
}

function getArgValue(flag: string): string | null {
  const index = process.argv.indexOf(flag)
  if (index === -1) return null
  const value = process.argv[index + 1]
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

function requireEnv(name: string, value: string | undefined): string {
  if (!value || value.trim().length === 0) {
    throw new Error(`Missing required environment variable: ${name}`)
  }
  return value
}

function parseServiceAccount(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('GOOGLE_SERVICE_ACCOUNT_KEY must decode to an object')
    }
    return parsed as Record<string, unknown>
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`Failed to parse GOOGLE_SERVICE_ACCOUNT_KEY JSON: ${message}`)
  }
}

async function validateGoogleAuth(serviceAccount: Record<string, unknown>) {
  const { google } = await import('googleapis')
  const auth = new google.auth.GoogleAuth({
    credentials: serviceAccount,
    scopes: ['https://www.googleapis.com/auth/calendar'],
  })
  await auth.getClient()
}

async function run() {
  if (hasFlag('--confirm')) {
    throw new Error('This script is read-only and does not support --confirm.')
  }

  const envPath = path.resolve(process.cwd(), '.env.local')
  if (!fs.existsSync(envPath)) {
    throw new Error('.env.local not found')
  }

  config({ path: envPath })
  console.log('Loaded .env.local')
  console.log('\n=== Google Service Account Key Fixer (Read-Only by Default) ===\n')

  const keyString = requireEnv('GOOGLE_SERVICE_ACCOUNT_KEY', process.env.GOOGLE_SERVICE_ACCOUNT_KEY)
  const serviceAccount = parseServiceAccount(keyString)
  console.log('Successfully parsed service account JSON')

  const privateKey = serviceAccount.private_key
  if (typeof privateKey !== 'string' || privateKey.length === 0) {
    throw new Error('No private_key field found in GOOGLE_SERVICE_ACCOUNT_KEY')
  }

  console.log('\nOriginal private key stats:')
  console.log('- Length:', privateKey.length)
  console.log('- Line count:', privateKey.split('\n').length)

  const fixedPrivateKey = privateKey.replace(/\\n/g, '\n')
  console.log('\nFixed private key stats:')
  console.log('- Length:', fixedPrivateKey.length)
  console.log('- Line count:', fixedPrivateKey.split('\n').length)

  const fixedServiceAccount = { ...serviceAccount, private_key: fixedPrivateKey }
  const fixedJson = JSON.stringify(fixedServiceAccount)

  console.log('\nFixed service account key generated')
  console.log('\nTo fix your .env.local file:')
  console.log('1. Open .env.local in your editor')
  console.log('2. Replace the entire GOOGLE_SERVICE_ACCOUNT_KEY line with the following:')
  console.log('\n' + '='.repeat(80))
  console.log('GOOGLE_SERVICE_ACCOUNT_KEY=' + fixedJson)
  console.log('='.repeat(80) + '\n')

  console.log('Testing the fixed key...')
  await validateGoogleAuth(fixedServiceAccount)
  console.log('Google auth client obtained successfully.')

  const shouldWriteJson = hasFlag('--write-json')
  const outputPath = path.resolve(process.cwd(), getArgValue('--output-path') ?? 'google-service-account-fixed.json')

  if (!shouldWriteJson) {
    console.log('\nSkipping JSON file write by default. Use --write-json to persist the fixed key locally.')
    return
  }

  fs.writeFileSync(outputPath, JSON.stringify(fixedServiceAccount, null, 2))
  console.log(`Saved fixed service account JSON to: ${outputPath}`)
  console.log(`To use file-based auth: GOOGLE_APPLICATION_CREDENTIALS=${outputPath}`)
}

run().catch((error) => {
  console.error('Fatal error:', error)
  process.exitCode = 1
})
