import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import { resolve } from 'path';

// Load environment variables
dotenv.config({ path: resolve(__dirname, '../.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const supabase = createClient(supabaseUrl, supabaseServiceKey);

// UK bank validation patterns from the migration
const accountNumberRegex = /^[0-9]{8}$/;
const sortCodeRegex = /^[0-9]{2}-?[0-9]{2}-?[0-9]{2}$/;

async function checkInvalidBankDetails() {
  console.log('Checking for employees with invalid bank details...\n');

  // Get all employee financial details
  const { data: financialDetails, error } = await supabase
    .from('employee_financial_details')
    .select(`
      id,
      employee_id,
      bank_account_number,
      bank_sort_code,
      employees!inner(first_name, last_name)
    `)
    .order('created_at', { ascending: true });

  if (error) {
    console.error('Error fetching financial details:', error);
    return;
  }

  const invalidDetails: any[] = [];

  financialDetails.forEach(detail => {
    const issues: string[] = [];
    
    // Check account number
    if (detail.bank_account_number && !accountNumberRegex.test(detail.bank_account_number)) {
      issues.push(`Invalid account number: "${detail.bank_account_number}" (should be 8 digits)`);
    }
    
    // Check sort code
    if (detail.bank_sort_code && !sortCodeRegex.test(detail.bank_sort_code)) {
      issues.push(`Invalid sort code: "${detail.bank_sort_code}" (should be XX-XX-XX or XXXXXX)`);
    }
    
    if (issues.length > 0) {
      invalidDetails.push({
        ...detail,
        issues,
        employee: detail.employees
      });
    }
  });

  console.log(`Total financial records: ${financialDetails.length}`);
  console.log(`Records with invalid bank details: ${invalidDetails.length}\n`);

  if (invalidDetails.length > 0) {
    console.log('Invalid bank details found:');
    console.log('=====================================');
    
    invalidDetails.forEach((detail, index) => {
      console.log(`\n${index + 1}. ${detail.employee.first_name} ${detail.employee.last_name} (Employee ID: ${detail.employee_id})`);
      
      detail.issues.forEach((issue: string) => {
        console.log(`   - ${issue}`);
        
        // Suggest fixes
        if (issue.includes('account number')) {
          const cleaned = detail.bank_account_number.replace(/[^0-9]/g, '');
          console.log(`     Suggested: "${cleaned}" (${cleaned.length} digits)`);
          
          if (cleaned.length < 8) {
            console.log(`     WARNING: Account number too short (${cleaned.length} digits, need 8)`);
          } else if (cleaned.length > 8) {
            console.log(`     WARNING: Account number too long (${cleaned.length} digits, need 8)`);
            console.log(`     Maybe try: "${cleaned.substring(0, 8)}" or "${cleaned.substring(cleaned.length - 8)}"`);
          }
        }
        
        if (issue.includes('sort code')) {
          let cleaned = detail.bank_sort_code.replace(/[^0-9]/g, '');
          
          if (cleaned.length === 6) {
            const formatted = `${cleaned.substring(0, 2)}-${cleaned.substring(2, 4)}-${cleaned.substring(4, 6)}`;
            console.log(`     Suggested: "${formatted}"`);
          } else {
            console.log(`     WARNING: Sort code has wrong length (${cleaned.length} digits, need 6)`);
          }
        }
      });
    });
    
    console.log('\n=====================================');
    console.log('\nTo fix these issues, you can either:');
    console.log('1. Run the cleanup script to auto-fix bank details');
    console.log('2. Update the migration to clean data before applying constraints');
    console.log('3. Manually fix the bank details in the database');
    console.log('\nNote: UK bank account numbers should be exactly 8 digits');
    console.log('      UK sort codes should be 6 digits (formatted as XX-XX-XX)');
  } else {
    console.log('✅ All bank details are valid!');
  }
}

checkInvalidBankDetails().catch(console.error);