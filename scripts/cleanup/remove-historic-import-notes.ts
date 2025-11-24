
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';

// Load environment variables
dotenv.config({ path: path.join(process.cwd(), '.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceRoleKey) {
  console.error('Missing Supabase URL or Service Role Key');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceRoleKey);

async function removeHistoricImportNotes() {
  console.log('🧹 Removing "Historic Import" from cashing up notes...');

  // 1. Fetch sessions with "Historic Import" in notes
  const { data: sessions, error: fetchError } = await supabase
    .from('cashup_sessions')
    .select('id, notes')
    .ilike('notes', '%Historic Import%');

  if (fetchError) {
    console.error('Error fetching sessions:', fetchError);
    return;
  }

  if (!sessions || sessions.length === 0) {
    console.log('No sessions found with "Historic Import" in notes.');
    return;
  }

  console.log(`Found ${sessions.length} sessions to update.`);

  let updatedCount = 0;
  let errorCount = 0;

  for (const session of sessions) {
    if (!session.notes) continue; // Should not happen due to filter, but safety first

    // Remove "Historic Import" and trim whitespace
    // Regex handles:
    // 1. "Historic Import" literal
    // 2. Surrounding whitespace clean up to avoid "  " or leading/trailing space
    let newNotes = session.notes.replace(/Historic Import/gi, '').trim();
    
    // Optional: clean up double spaces if they were created in the middle
    newNotes = newNotes.replace(/\s\s+/g, ' ');

    // If the note becomes empty (it was ONLY "Historic Import"), set it to null or empty string
    // Database schema allows NULL for notes (TEXT NULL)
    const finalNotes = newNotes.length === 0 ? null : newNotes;

    const { error: updateError } = await supabase
      .from('cashup_sessions')
      .update({ notes: finalNotes })
      .eq('id', session.id);

    if (updateError) {
      console.error(`Error updating session ${session.id}:`, updateError);
      errorCount++;
    } else {
        // console.log(`Updated session ${session.id}: "${session.notes}" -> "${finalNotes}"`);
      updatedCount++;
    }
  }

  console.log(`✅ Completed. Updated: ${updatedCount}, Errors: ${errorCount}`);
}

removeHistoricImportNotes().catch(console.error);
