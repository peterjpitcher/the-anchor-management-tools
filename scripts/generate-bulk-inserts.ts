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
  
  const dataLines = lines.slice(2);
  const messages: TwilioMessage[] = [];
  
  for (const line of dataLines) {
    const cleanLine = line.trim().replace(/^\|/, '').replace(/\|$/, '');
    const parts = cleanLine.split(' | ').map(part => part.trim());
    
    if (parts.length < 7) continue;
    
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

function generateBulkInserts(messages: TwilioMessage[]): string {
  const statements: string[] = [];
  
  // Generate INSERT statements in batches
  const batchSize = 100;
  
  for (let i = 0; i < messages.length; i += batchSize) {
    const batch = messages.slice(i, i + batchSize);
    
    statements.push('INSERT INTO message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES');
    
    const values = batch.map((msg, index) => {
      const isLast = index === batch.length - 1;
      return `  ('${escapeString(msg.From)}', '${escapeString(msg.To)}', '${escapeString(msg.Body)}', '${escapeString(msg.Status)}', '${escapeString(msg.SentDate)}', '${escapeString(msg.Direction)}', '${escapeString(msg.Sid)}')${isLast ? ';' : ','}`;
    });
    
    statements.push(...values);
    statements.push(''); // Empty line between batches
  }
  
  return statements.join('\n');
}

// Process files
const tempDir = path.join(__dirname, '../temporary');
const files = fs.readdirSync(tempDir).filter(f => f.startsWith('sms-log-') && f.endsWith('.md'));

let allMessages: TwilioMessage[] = [];
for (const file of files) {
  const messages = parseTwilioExport(path.join(tempDir, file));
  allMessages = allMessages.concat(messages);
}

console.log(`Total messages: ${allMessages.length}`);
console.log(`Generating INSERT statements in batches of 100...`);

const inserts = generateBulkInserts(allMessages);
const outputPath = path.join(__dirname, '../supabase/migrations/20241215_bulk_inserts.sql');

// Write header and inserts
const fullContent = `-- Bulk INSERT statements for message import
-- Total messages: ${allMessages.length}
-- Run 20241215_bulk_import_clean.sql first, then run this file

${inserts}`;

fs.writeFileSync(outputPath, fullContent);

console.log(`\nGenerated: ${outputPath}`);
console.log(`This file contains ${Math.ceil(allMessages.length / 100)} INSERT statements (100 messages each)`);
console.log('\nTo import:');
console.log('1. DELETE FROM messages; -- Clear existing messages');
console.log('2. Run: 20241215_bulk_import_clean.sql');
console.log('3. Run: 20241215_bulk_inserts.sql');