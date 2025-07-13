import { createAdminClient } from '../src/lib/supabase/server';

async function addRedemptionFields() {
  console.log('Adding redemption code fields...');
  
  const supabase = await createAdminClient();
  
  try {
    // Add code column
    const { error: codeError } = await supabase.rpc('exec_sql', {
      sql: `
        ALTER TABLE reward_redemptions 
        ADD COLUMN IF NOT EXISTS code VARCHAR(10) UNIQUE;
      `
    });
    
    if (codeError) {
      console.error('Error adding code column:', codeError);
    } else {
      console.log('✓ Added code column');
    }
    
    // Add expires_at column
    const { error: expiresError } = await supabase.rpc('exec_sql', {
      sql: `
        ALTER TABLE reward_redemptions 
        ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;
      `
    });
    
    if (expiresError) {
      console.error('Error adding expires_at column:', expiresError);
    } else {
      console.log('✓ Added expires_at column');
    }
    
    // Create indexes
    const { error: indexError1 } = await supabase.rpc('exec_sql', {
      sql: `
        CREATE INDEX IF NOT EXISTS idx_reward_redemptions_code 
        ON reward_redemptions(code) WHERE code IS NOT NULL;
      `
    });
    
    if (indexError1) {
      console.error('Error creating code index:', indexError1);
    } else {
      console.log('✓ Created code index');
    }
    
    const { error: indexError2 } = await supabase.rpc('exec_sql', {
      sql: `
        CREATE INDEX IF NOT EXISTS idx_reward_redemptions_expires_at 
        ON reward_redemptions(expires_at) WHERE expires_at IS NOT NULL;
      `
    });
    
    if (indexError2) {
      console.error('Error creating expires_at index:', indexError2);
    } else {
      console.log('✓ Created expires_at index');
    }
    
    console.log('\nRedemption fields added successfully!');
  } catch (error) {
    console.error('Unexpected error:', error);
  }
}

// Run the script
addRedemptionFields().catch(console.error);