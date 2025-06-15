import fs from 'fs';
import path from 'path';

interface TwilioMessage {
  From: string;
  To: string;
  Body: string;
  Status: string;
  SentDate: string;
  Direction: string;
  Sid: string;
}

function parseTwilioExport(filePath: string): TwilioMessage[] {
  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split('\n').filter(line => line.trim());
  
  // Skip header lines (header and separator)
  const dataLines = lines.slice(2);
  
  const messages: TwilioMessage[] = [];
  
  for (const line of dataLines) {
    // Remove leading and trailing pipes and whitespace
    const cleanLine = line.trim().replace(/^\|/, '').replace(/\|$/, '');
    
    // Split by ' | '
    const parts = cleanLine.split(' | ').map(part => part.trim());
    
    if (parts.length < 7) continue; // Skip incomplete lines
    
    messages.push({
      From: parts[0],
      To: parts[1],
      Body: parts[2],
      Status: parts[3],
      SentDate: parts[4],
      Direction: parts[5],
      Sid: parts[6]
    });
  }
  
  return messages;
}

function escapeString(str: string): string {
  return str.replace(/'/g, "''");
}

function generateSQL(messages: TwilioMessage[]): string {
  const insertStatements: string[] = [];
  
  // Start with the migration header
  insertStatements.push('-- Auto-generated from Twilio export');
  insertStatements.push('-- Insert data into temporary table for processing\n');
  
  // Generate insert statements
  for (const msg of messages) {
    const sql = `INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '${escapeString(msg.From)}',
  '${escapeString(msg.To)}',
  '${escapeString(msg.Body)}',
  '${escapeString(msg.Status)}',
  '${escapeString(msg.SentDate)}',
  '${escapeString(msg.Direction)}',
  '${escapeString(msg.Sid)}'
);`;
    insertStatements.push(sql);
  }
  
  // Add the import execution
  insertStatements.push('\n-- Execute the import');
  insertStatements.push('SELECT * FROM import_message_history();');
  
  // Add cleanup
  insertStatements.push('\n-- Clean up');
  insertStatements.push('DROP TABLE IF EXISTS temp_message_import;');
  insertStatements.push('SELECT cleanup_import();');
  
  return insertStatements.join('\n');
}

// Process files
const tempDir = path.join(__dirname, '../temporary');
const files = fs.readdirSync(tempDir).filter(f => f.startsWith('sms-log-') && f.endsWith('.md'));

console.log(`Found ${files.length} files to process`);

let allMessages: TwilioMessage[] = [];

for (const file of files) {
  console.log(`Processing ${file}...`);
  const messages = parseTwilioExport(path.join(tempDir, file));
  console.log(`  Found ${messages.length} messages`);
  allMessages = allMessages.concat(messages);
}

console.log(`\nTotal messages: ${allMessages.length}`);
console.log(`Inbound: ${allMessages.filter(m => m.Direction === 'inbound').length}`);
console.log(`Outbound: ${allMessages.filter(m => m.Direction === 'outbound-api').length}`);

// Generate SQL
const sql = generateSQL(allMessages);
const outputPath = path.join(__dirname, '../supabase/migrations/20241215_import_message_data.sql');
fs.writeFileSync(outputPath, sql);

console.log(`\nSQL migration generated: ${outputPath}`);
console.log('\nTo import the messages:');
console.log('1. Run the base migration: 20241215_import_message_history.sql');
console.log('2. Run the data migration: 20241215_import_message_data.sql');
console.log('\nNote: Make sure all customers exist in the database before importing.');