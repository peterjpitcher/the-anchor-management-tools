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

  // Check table columns
  const { data: columns, error: columnsError } = await supabase
    .rpc('get_table_columns', { table_name: 'event_categories' });

  if (columnsError) {
    console.error('Error fetching columns:', columnsError);
    return;
  }

  console.log('Current columns in event_categories table:');
  const columnNames = columns?.map((col: any) => col.column_name) || [];
  columnNames.forEach((col: string) => console.log(`  - ${col}`));

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
    const exists = columnNames.includes(col);
    console.log(`  - ${col}: ${exists ? '✅ EXISTS' : '❌ MISSING'}`);
  });

  // Check constraints
  const { data: constraints, error: constraintsError } = await supabase
    .rpc('get_table_constraints', { table_name: 'event_categories' });

  if (constraintsError) {
    console.error('Error fetching constraints:', constraintsError);
    return;
  }

  console.log('\nConstraints on event_categories table:');
  const constraintNames = constraints?.map((c: any) => c.constraint_name) || [];
  constraintNames.forEach((c: string) => console.log(`  - ${c}`));

  const newConstraints = [
    'check_default_event_status',
    'check_default_performer_type'
  ];

  console.log('\nNew constraints from migration:');
  newConstraints.forEach(constraint => {
    const exists = constraintNames.includes(constraint);
    console.log(`  - ${constraint}: ${exists ? '✅ EXISTS' : '❌ MISSING'}`);
  });

  // Check indexes
  const { data: indexes, error: indexesError } = await supabase
    .rpc('get_table_indexes', { table_name: 'event_categories' });

  if (indexesError) {
    console.error('Error fetching indexes:', indexesError);
    return;
  }

  console.log('\nIndexes on event_categories table:');
  const indexNames = indexes?.map((i: any) => i.indexname) || [];
  indexNames.forEach((i: string) => console.log(`  - ${i}`));

  const hasSlugIndex = indexNames.some((i: string) => i.includes('slug'));
  console.log(`\nSlug index: ${hasSlugIndex ? '✅ EXISTS' : '❌ MISSING'}`);

  // Check if slug column has unique constraint
  if (columnNames.includes('slug')) {
    const { data: uniqueConstraints } = await supabase
      .rpc('get_column_constraints', { 
        table_name: 'event_categories',
        column_name: 'slug'
      });
    
    const hasUniqueConstraint = uniqueConstraints?.some((c: any) => 
      c.constraint_type === 'UNIQUE'
    );
    console.log(`Slug unique constraint: ${hasUniqueConstraint ? '✅ EXISTS' : '❌ MISSING'}`);
  }
}

// Create the required functions if they don't exist
async function createHelperFunctions() {
  try {
    await supabase.rpc('exec_sql', {
      sql: `
        CREATE OR REPLACE FUNCTION get_table_columns(table_name text)
        RETURNS TABLE(column_name text, data_type text, is_nullable text)
        LANGUAGE sql
        SECURITY DEFINER
        AS $$
          SELECT column_name::text, data_type::text, is_nullable::text
          FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = $1
          ORDER BY ordinal_position;
        $$;
        
        CREATE OR REPLACE FUNCTION get_table_constraints(table_name text)
        RETURNS TABLE(constraint_name text, constraint_type text)
        LANGUAGE sql
        SECURITY DEFINER
        AS $$
          SELECT constraint_name::text, constraint_type::text
          FROM information_schema.table_constraints
          WHERE table_schema = 'public' AND table_name = $1;
        $$;
        
        CREATE OR REPLACE FUNCTION get_table_indexes(table_name text)
        RETURNS TABLE(indexname text)
        LANGUAGE sql
        SECURITY DEFINER
        AS $$
          SELECT indexname::text
          FROM pg_indexes
          WHERE schemaname = 'public' AND tablename = $1;
        $$;
        
        CREATE OR REPLACE FUNCTION get_column_constraints(table_name text, column_name text)
        RETURNS TABLE(constraint_name text, constraint_type text)
        LANGUAGE sql
        SECURITY DEFINER
        AS $$
          SELECT tc.constraint_name::text, tc.constraint_type::text
          FROM information_schema.table_constraints tc
          JOIN information_schema.constraint_column_usage ccu 
            ON tc.constraint_name = ccu.constraint_name
          WHERE tc.table_schema = 'public' 
            AND tc.table_name = $1
            AND ccu.column_name = $2;
        $$;
        
        CREATE OR REPLACE FUNCTION exec_sql(sql text)
        RETURNS void
        LANGUAGE plpgsql
        SECURITY DEFINER
        AS $$
        BEGIN
          EXECUTE sql;
        END;
        $$;
      `
    });
  } catch (error) {
    console.log('Helper functions may already exist');
  }
}

createHelperFunctions().then(() => checkMigrationStatus());