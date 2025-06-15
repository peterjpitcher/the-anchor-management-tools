import fs from 'fs';
import path from 'path';

// Read the functions file
const functionsPath = path.join(__dirname, '../supabase/migrations/20241215_import_message_history.sql');
const dataPath = path.join(__dirname, '../supabase/migrations/20241215_import_message_data.sql');
const outputPath = path.join(__dirname, '../supabase/migrations/20241215_complete_message_import.sql');

// Read files
const functionsContent = fs.readFileSync(functionsPath, 'utf-8');
const dataContent = fs.readFileSync(dataPath, 'utf-8');

// Extract just the INSERT statements from the data file
const lines = dataContent.split('\n');
const insertStatements: string[] = [];
let currentStatement = '';
let inInsert = false;

for (const line of lines) {
  if (line.startsWith('INSERT INTO temp_message_import')) {
    inInsert = true;
    currentStatement = line;
  } else if (inInsert) {
    currentStatement += '\n' + line;
    if (line.trim().endsWith(');')) {
      insertStatements.push(currentStatement);
      currentStatement = '';
      inInsert = false;
    }
  }
}

// Build the complete file
const completeContent = `-- Complete migration to import message history from Twilio export
-- This single file contains all functions and data needed for the import
-- Run this file to import all message history

${functionsContent}

-- Insert message data
${insertStatements.join('\n')}

-- Execute the import and show results
SELECT * FROM import_message_history();

-- Clean up
DROP FUNCTION IF EXISTS import_message_history();
DROP FUNCTION IF EXISTS find_customer_by_phone(TEXT);
DROP FUNCTION IF EXISTS clean_phone_for_match(TEXT);
`;

// Write the complete file
fs.writeFileSync(outputPath, completeContent);

console.log(`Complete migration file created: ${outputPath}`);
console.log(`Total INSERT statements: ${insertStatements.length}`);