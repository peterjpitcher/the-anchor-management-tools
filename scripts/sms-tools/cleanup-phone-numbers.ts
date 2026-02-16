import * as dotenv from 'dotenv';
import { resolve } from 'path';
import {
  assertScriptMutationSucceeded,
  assertScriptQuerySucceeded
} from '../../src/lib/script-mutation-safety';
import { createAdminClient } from '../../src/lib/supabase/admin';
import {
  assertPhoneCleanupCompletedWithoutFailures,
  extractPhoneCleanupCandidates
} from '../../src/lib/phone-cleanup-safety';
import {
  assertCleanupPhoneNumbersLimit,
  assertCleanupPhoneNumbersMutationAllowed,
  assertCleanupPhoneNumbersRunEnabled,
  readCleanupPhoneNumbersLimit
} from '../../src/lib/cleanup-phone-numbers-script-safety'

// Load environment variables
dotenv.config({ path: resolve(process.cwd(), '.env.local') });

function getSupabaseClient() {
  return createAdminClient();
}

// UK phone number regex pattern from the migration
const phoneRegex = /^(\+?44|0)?[0-9]{10,11}$/;

function cleanPhoneNumber(phone: string): { cleaned: string; valid: boolean } {
  let cleaned = phone;
  
  // Remove common formatting characters
  cleaned = cleaned.replace(/[\s\-\(\)\.]/g, '');
  
  // Handle country codes
  if (cleaned.startsWith('+44')) {
    cleaned = cleaned.substring(3); // Remove +44
    cleaned = '0' + cleaned; // Add leading 0
  } else if (cleaned.startsWith('44') && cleaned.length > 11) {
    cleaned = cleaned.substring(2); // Remove 44
    cleaned = '0' + cleaned; // Add leading 0
  } else if (!cleaned.startsWith('0') && cleaned.length === 10) {
    cleaned = '0' + cleaned; // Add missing leading 0
  }
  
  // Remove any non-digit characters
  cleaned = cleaned.replace(/[^0-9]/g, '');
  
  // Check validity
  const valid = phoneRegex.test(cleaned);
  
  return { cleaned, valid };
}

async function cleanupPhoneNumbers() {
  const argv = process.argv
  const confirm = argv.includes('--confirm')
  const dryRun = !confirm || argv.includes('--dry-run')
  const runMutations = confirm && !argv.includes('--dry-run')
  const HARD_CAP = 500

  if (argv.includes('--help')) {
    console.log(`
cleanup-phone-numbers (safe by default)

Dry-run (default):
  tsx scripts/sms-tools/cleanup-phone-numbers.ts

Mutation mode (requires multi-gating + explicit caps):
  RUN_CLEANUP_PHONE_NUMBERS_MUTATION=true ALLOW_CLEANUP_PHONE_NUMBERS_MUTATION=true \\
    tsx scripts/sms-tools/cleanup-phone-numbers.ts --confirm --limit 50

Notes:
  - Use --dry-run to force analysis mode even with --confirm.
  - You can also set CLEANUP_PHONE_NUMBERS_LIMIT instead of --limit.
`)
    return
  }

  const limit = readCleanupPhoneNumbersLimit(argv)
  if (runMutations) {
    assertCleanupPhoneNumbersRunEnabled()
    assertCleanupPhoneNumbersMutationAllowed()
    assertCleanupPhoneNumbersLimit(limit ?? 0, HARD_CAP)
  }

  console.log(`Starting phone number cleanup (${dryRun ? 'DRY-RUN' : 'MUTATION'})...\n`)
  const supabase = getSupabaseClient();

  // Get all customers with phone numbers
  const { data: customers, error } = await supabase
    .from('customers')
    .select('id, first_name, last_name, mobile_number')
    .not('mobile_number', 'is', null)
    .order('created_at', { ascending: true });

  const candidateRows = (assertScriptQuerySucceeded({
    operation: 'Load customers for phone cleanup',
    error,
    data: customers ?? [],
    allowMissing: true
  }) ?? []) as Array<{
    id: string
    first_name: string | null
    last_name: string | null
    mobile_number: string
  }>;

  const cleanupCandidates = extractPhoneCleanupCandidates(candidateRows);

  type CleanupAction = {
    id: string
    firstName: string
    lastName: string
    mobileNumber: string
    cleaned: string
  }

  const updateActions: CleanupAction[] = []
  let invalidFormatCount = 0
  const failures: string[] = [];
  const unresolvedCustomers: Array<{
    id: string
    firstName: string
    lastName: string
    mobileNumber: string
    reason: string
  }> = [];

  console.log(`Checking ${cleanupCandidates.length} customers...\n`);

  for (const customer of cleanupCandidates) {
    const { cleaned, valid } = cleanPhoneNumber(customer.mobileNumber);
    
    if (cleaned !== customer.mobileNumber) {
      if (valid) {
        updateActions.push({
          id: customer.id,
          firstName: customer.firstName,
          lastName: customer.lastName,
          mobileNumber: customer.mobileNumber,
          cleaned
        })
      } else {
        console.log(`✗ Cannot fix ${customer.firstName} ${customer.lastName}: "${customer.mobileNumber}" (invalid format)`);
        invalidFormatCount++;
        failures.push(`invalid_format:${customer.id}`);
        unresolvedCustomers.push({
          id: customer.id,
          firstName: customer.firstName,
          lastName: customer.lastName,
          mobileNumber: customer.mobileNumber,
          reason: 'invalid format'
        });
      }
    }
  }

  const updatesToApply =
    runMutations
      ? updateActions.slice(0, Math.min(updateActions.length, limit ?? 0))
      : []

  console.log(`\nDetected ${updateActions.length} customer(s) needing cleanup.`)
  if (updateActions.length > 0) {
    const sampleSource = runMutations ? updatesToApply : updateActions
    const sample = sampleSource.slice(0, 10)
    console.log(`Sample ${dryRun ? 'would-update' : 'will-update'} set:`)
    sample.forEach((entry) => {
      console.log(`  - ${entry.firstName} ${entry.lastName} [${entry.id}]: "${entry.mobileNumber}" → "${entry.cleaned}"`)
    })
    if (sampleSource.length > sample.length) {
      console.log(`  ... and ${sampleSource.length - sample.length} more`)
    }
  }

  let updated = 0

  if (runMutations) {
    if (updateActions.length > updatesToApply.length) {
      console.log(
        `\nCap will apply ${updatesToApply.length}/${updateActions.length} update(s); rerun to process the remainder.`
      )
    }

    console.log(`\nApplying ${updatesToApply.length} update(s) (cap applied).\n`)
    for (const action of updatesToApply) {
      const { data: updatedRow, error: updateError } = await supabase
        .from('customers')
        .update({ mobile_number: action.cleaned })
        .eq('id', action.id)
        // Guard check-then-update races by ensuring we only update if the phone number is unchanged.
        .eq('mobile_number', action.mobileNumber)
        .select('id')
        .maybeSingle()

      try {
        assertScriptMutationSucceeded({
          operation: `Update customer phone ${action.id}`,
          error: updateError,
          updatedRows: updatedRow ? [{ id: updatedRow.id }] : [],
          allowZeroRows: false
        })
        console.log(`✓ Updated ${action.firstName} ${action.lastName}: "${action.mobileNumber}" → "${action.cleaned}"`)
        updated += 1
      } catch (mutationError) {
        const reason = mutationError instanceof Error ? mutationError.message : String(mutationError)
        console.error(`Failed to update customer ${action.id}:`, reason)
        failures.push(`update_failed:${action.id}:${reason}`)
        unresolvedCustomers.push({
          id: action.id,
          firstName: action.firstName,
          lastName: action.lastName,
          mobileNumber: action.mobileNumber,
          reason
        })
      }
    }
  } else {
    // Dry-run mode: no customer rows updated.
  }

  console.log('\n=====================================');
  console.log(`Cleanup Summary:`);
  console.log(`- Total customers checked: ${cleanupCandidates.length}`);
  console.log(`- Customers requiring updates: ${updateActions.length}`);
  console.log(`- Successfully updated: ${updated}`);
  if (runMutations) {
    const skippedDueToCap = Math.max(0, updateActions.length - updatesToApply.length)
    console.log(`- Skipped due to cap: ${skippedDueToCap}`);
  }
  console.log(`- Failed to fix: ${failures.length}`);
  console.log(`- Invalid format failures: ${invalidFormatCount}`);
  console.log('=====================================\n');

  if (unresolvedCustomers.length > 0) {
    console.log('Failed customers that need manual intervention:');
    const previewLimit = 50
    unresolvedCustomers.slice(0, previewLimit).forEach((customer, index) => {
      console.log(`${index + 1}. ${customer.firstName} ${customer.lastName} (ID: ${customer.id}): "${customer.mobileNumber}" (${customer.reason})`);
    })
    if (unresolvedCustomers.length > previewLimit) {
      console.log(`... and ${unresolvedCustomers.length - previewLimit} more`)
    }
    
    console.log('\nThese phone numbers need to be manually corrected in the database.');
    console.log('They should follow the format: 07xxxxxxxxx or 01xxxxxxxxx (11 digits starting with 0)');
  }

  assertPhoneCleanupCompletedWithoutFailures(failures)

  if (dryRun) {
    console.log('\n✅ Dry-run complete. No mutations performed.')
    if (updateActions.length === 0) {
      console.log('\nNo cleanup needed; you can now run the migration again.')
    } else {
      console.log(
        '\nTo mutate, pass --confirm --limit <n> and set RUN_CLEANUP_PHONE_NUMBERS_MUTATION=true and ALLOW_CLEANUP_PHONE_NUMBERS_MUTATION=true.'
      )
    }
    return
  }

  const remainingUpdates = Math.max(0, updateActions.length - updatesToApply.length)
  console.log('\n✅ cleanup-phone-numbers completed without unresolved failures.')
  if (remainingUpdates === 0) {
    console.log('\nYou can now run the migration again.')
  } else {
    console.log(`\n${remainingUpdates} update(s) remain due to cap; rerun in another batch before rerunning the migration.`)
  }
}

cleanupPhoneNumbers().catch((error) => {
  console.error('cleanup-phone-numbers script failed:', error);
  process.exitCode = 1;
});
