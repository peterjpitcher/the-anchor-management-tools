#!/usr/bin/env node
import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('Missing environment variables');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function checkMigrationStatus() {
  console.log('Checking event_categories migration status...\n');

  // Test query to check columns by selecting from the table
  const { data: sample, error: sampleError } = await supabase
    .from('event_categories')
    .select('*')
    .limit(1);

  if (sampleError) {
    console.error('Error fetching sample data:', sampleError);
    return;
  }

  console.log('Sample event_category record:');
  if (sample && sample.length > 0) {
    const record = sample[0];
    const columns = Object.keys(record);
    console.log('Columns found:', columns);

    // Check which new columns exist
    const newColumns = [
      'default_end_time',
      'default_price',
      'default_is_free',
      'default_performer_type',
      'default_event_status',
      'slug',
      'meta_description'
    ];

    console.log('\nNew columns from migration:');
    newColumns.forEach(col => {
      const exists = columns.includes(col);
      console.log(`  - ${col}: ${exists ? '✅ EXISTS' : '❌ MISSING'}`);
    });

    // If slug exists, check if it has values
    if (columns.includes('slug')) {
      const { data: slugCheck, error: slugError } = await supabase
        .from('event_categories')
        .select('id, name, slug')
        .is('slug', null);

      if (!slugError && slugCheck) {
        console.log(`\nCategories with NULL slugs: ${slugCheck.length}`);
        if (slugCheck.length > 0) {
          console.log('Categories needing slugs:');
          slugCheck.forEach(cat => console.log(`  - ${cat.name} (ID: ${cat.id})`));
        }
      }
    }

    // Check for duplicate slugs
    if (columns.includes('slug')) {
      const { data: allCats, error: allError } = await supabase
        .from('event_categories')
        .select('slug')
        .not('slug', 'is', null);

      if (!allError && allCats) {
        const slugCounts = allCats.reduce((acc: any, cat: any) => {
          acc[cat.slug] = (acc[cat.slug] || 0) + 1;
          return acc;
        }, {});

        const duplicates = Object.entries(slugCounts).filter(([_, count]) => (count as number) > 1);
        if (duplicates.length > 0) {
          console.log('\nDuplicate slugs found:');
          duplicates.forEach(([slug, count]) => console.log(`  - ${slug}: ${count} occurrences`));
        } else {
          console.log('\nNo duplicate slugs found ✅');
        }
      }
    }
  } else {
    console.log('No event categories found in the database');
  }

  // Try to test constraints by attempting invalid inserts
  console.log('\nTesting constraints...');

  // Test default_event_status constraint
  if (sample && sample[0] && 'default_event_status' in sample[0]) {
    const { error: statusError } = await supabase
      .from('event_categories')
      .insert({
        name: 'Test Invalid Status ' + Date.now(),
        default_event_status: 'invalid_status'
      });

    if (statusError && statusError.message.includes('check_default_event_status')) {
      console.log('  - check_default_event_status: ✅ EXISTS (constraint working)');
    } else if (statusError) {
      console.log('  - check_default_event_status: ❓ Unknown (different error)', statusError.message);
    } else {
      console.log('  - check_default_event_status: ❌ MISSING (invalid value accepted)');
      // Clean up test record
      await supabase
        .from('event_categories')
        .delete()
        .like('name', 'Test Invalid Status%');
    }
  }

  // Test default_performer_type constraint
  if (sample && sample[0] && 'default_performer_type' in sample[0]) {
    const { error: performerError } = await supabase
      .from('event_categories')
      .insert({
        name: 'Test Invalid Performer ' + Date.now(),
        default_performer_type: 'invalid_performer'
      });

    if (performerError && performerError.message.includes('check_default_performer_type')) {
      console.log('  - check_default_performer_type: ✅ EXISTS (constraint working)');
    } else if (performerError) {
      console.log('  - check_default_performer_type: ❓ Unknown (different error)', performerError.message);
    } else {
      console.log('  - check_default_performer_type: ❌ MISSING (invalid value accepted)');
      // Clean up test record
      await supabase
        .from('event_categories')
        .delete()
        .like('name', 'Test Invalid Performer%');
    }
  }

  // Test slug unique constraint
  if (sample && sample[0] && 'slug' in sample[0] && sample[0].slug) {
    const { error: slugError } = await supabase
      .from('event_categories')
      .insert({
        name: 'Test Duplicate Slug ' + Date.now(),
        slug: sample[0].slug // Try to use existing slug
      });

    if (slugError && (slugError.message.includes('unique') || slugError.message.includes('duplicate'))) {
      console.log('  - slug UNIQUE constraint: ✅ EXISTS (constraint working)');
    } else if (slugError) {
      console.log('  - slug UNIQUE constraint: ❓ Unknown (different error)', slugError.message);
    } else {
      console.log('  - slug UNIQUE constraint: ❌ MISSING (duplicate slug accepted)');
      // Clean up test record
      await supabase
        .from('event_categories')
        .delete()
        .like('name', 'Test Duplicate Slug%');
    }
  }
}

checkMigrationStatus().catch(console.error);