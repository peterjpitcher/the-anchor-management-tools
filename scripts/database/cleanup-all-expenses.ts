#!/usr/bin/env tsx
/**
 * Cleanup: delete ALL rows from public.expenses and purge the expense-receipts
 * storage bucket. Exports a JSON backup of rows + file listing first.
 *
 * Usage: npx tsx scripts/database/cleanup-all-expenses.ts
 */

import dotenv from 'dotenv'
import path from 'path'
import fs from 'fs'
import { createAdminClient } from '../../src/lib/supabase/admin'

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

const BACKUP_DIR = path.resolve(process.cwd(), 'tasks')
const STAMP = new Date().toISOString().replace(/[:.]/g, '-')
const BACKUP_FILE = path.join(BACKUP_DIR, `expenses-backup-${STAMP}.json`)
const BUCKET = 'expense-receipts'

async function listAllBucketObjects(db: ReturnType<typeof createAdminClient>, prefix = ''): Promise<string[]> {
  const paths: string[] = []
  let offset = 0
  const limit = 1000

  while (true) {
    const { data, error } = await db.storage.from(BUCKET).list(prefix, { limit, offset })
    if (error) throw new Error(`Bucket list failed: ${error.message}`)
    if (!data || data.length === 0) break

    for (const obj of data) {
      const fullPath = prefix ? `${prefix}/${obj.name}` : obj.name
      // Supabase storage returns directories as entries with null id — recurse
      if (obj.id === null) {
        const nested = await listAllBucketObjects(db, fullPath)
        paths.push(...nested)
      } else {
        paths.push(fullPath)
      }
    }

    if (data.length < limit) break
    offset += limit
  }

  return paths
}

async function main() {
  const db = createAdminClient()

  // Step 1: Count + fetch all rows for backup
  console.log('\n=== Step 1: Backup ===')
  const { data: expenses, error: fetchErr } = await db
    .from('expenses')
    .select('*')
  if (fetchErr) throw new Error(`Fetch expenses failed: ${fetchErr.message}`)

  const { data: files, error: filesErr } = await db
    .from('expense_files')
    .select('*')
  if (filesErr) throw new Error(`Fetch expense_files failed: ${filesErr.message}`)

  const bucketPaths = await listAllBucketObjects(db)

  console.log(`  expenses rows:        ${expenses?.length ?? 0}`)
  console.log(`  expense_files rows:   ${files?.length ?? 0}`)
  console.log(`  bucket objects found: ${bucketPaths.length}`)

  if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true })
  fs.writeFileSync(
    BACKUP_FILE,
    JSON.stringify({ timestamp: new Date().toISOString(), expenses, expense_files: files, bucket_paths: bucketPaths }, null, 2),
    'utf8',
  )
  console.log(`  backup written to:    ${BACKUP_FILE}`)

  if ((expenses?.length ?? 0) === 0 && (files?.length ?? 0) === 0 && bucketPaths.length === 0) {
    console.log('\nNothing to delete. Exiting.')
    return
  }

  // Step 2: Delete storage objects
  console.log('\n=== Step 2: Storage ===')
  if (bucketPaths.length > 0) {
    // remove() accepts up to 1000 paths per call
    const CHUNK = 1000
    let removed = 0
    for (let i = 0; i < bucketPaths.length; i += CHUNK) {
      const chunk = bucketPaths.slice(i, i + CHUNK)
      const { data, error } = await db.storage.from(BUCKET).remove(chunk)
      if (error) throw new Error(`Storage delete failed: ${error.message}`)
      removed += data?.length ?? 0
    }
    console.log(`  deleted ${removed} storage objects`)
  } else {
    console.log('  no storage objects to delete')
  }

  // Step 3: Delete DB rows (cascade handles expense_files)
  console.log('\n=== Step 3: Database ===')
  const { error: delErr, count } = await db
    .from('expenses')
    .delete({ count: 'exact' })
    .not('id', 'is', null) // delete all (PostgREST requires a filter)
  if (delErr) throw new Error(`Delete expenses failed: ${delErr.message}`)
  console.log(`  deleted ${count ?? 0} expenses rows (expense_files cascaded)`)

  // Step 4: Verify
  console.log('\n=== Step 4: Verify ===')
  const { count: expCount, error: vErr1 } = await db
    .from('expenses')
    .select('*', { count: 'exact', head: true })
  if (vErr1) throw new Error(`Verify expenses failed: ${vErr1.message}`)

  const { count: filesCount, error: vErr2 } = await db
    .from('expense_files')
    .select('*', { count: 'exact', head: true })
  if (vErr2) throw new Error(`Verify expense_files failed: ${vErr2.message}`)

  const remainingBucket = await listAllBucketObjects(db)

  console.log(`  expenses remaining:      ${expCount ?? 0}`)
  console.log(`  expense_files remaining: ${filesCount ?? 0}`)
  console.log(`  bucket objects remaining: ${remainingBucket.length}`)

  if ((expCount ?? 0) === 0 && (filesCount ?? 0) === 0 && remainingBucket.length === 0) {
    console.log('\n✓ Cleanup complete.')
  } else {
    console.error('\n✗ Cleanup incomplete — review output above.')
    process.exit(1)
  }
}

main().catch((err) => {
  console.error('\nFatal error:', err)
  process.exit(1)
})
