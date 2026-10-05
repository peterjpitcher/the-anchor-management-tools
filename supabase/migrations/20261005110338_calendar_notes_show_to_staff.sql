-- Calendar notes: let a manager choose which notes staff see in the staff portal.
--
-- The calendar holds two kinds of note side by side: ones staff should know about (owners
-- away, kitchen closed, clock changes, annual dates) and ones the owners add only for their
-- own planning (school terms, exam dates). Until now nothing told them apart.
--
-- show_to_staff  true  = the note is listed on the staff portal's My Shifts page.
--                false = managers only. It still shows on the dashboard, events and rota
--                        calendars, and it still syncs to Google Calendar.
--
-- Only the staff portal reads this column. The Google Calendar sync does not read it, so
-- every note syncs exactly as before.
--
-- Default true: most notes are for staff, and rows written by code that does not name the
-- column (the AI generator, a bulk load, the code deployed before this migration) stay
-- visible rather than vanishing.
--
-- Additive, with a constant default, so this is a metadata-only change and the code deployed
-- before it is unaffected. APPLY THIS BEFORE deploying the code that reads the column (a
-- query naming a missing column is a hard 400 in PostgREST).
--
-- No new table, view or function, so nothing changes for the anon role.

ALTER TABLE public.calendar_notes
  ADD COLUMN IF NOT EXISTS show_to_staff boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN public.calendar_notes.show_to_staff IS
  'True when staff see this note in the staff portal. False keeps it to managers. Google Calendar sync ignores it.';

-- Hide the owners' school and exam dates (owner decision, 5 October 2026). Pinned by id so
-- no other note can be caught by a pattern. An id that no longer exists is simply skipped.
--
-- The sync trigger fires on every UPDATE, so without care this would re-send all eighteen
-- notes to Google for a change Google never sees. It is switched off for this one statement
-- only. The DO block is a single statement, so if anything in it fails the whole block rolls
-- back and the trigger is left exactly as it was.
DO $$
BEGIN
  ALTER TABLE public.calendar_notes DISABLE TRIGGER queue_calendar_note_google_sync;

  UPDATE public.calendar_notes
  SET show_to_staff = false
  WHERE id IN (
    'f6a69906-5cae-4b1a-bd09-99836a3ebb07', -- School INSET Days, 3 to 4 Sep 2026
    '2496274b-ed47-4951-acdb-159b7699a1fd', -- Autumn Half Term, 17 Oct to 1 Nov 2026
    '7d169f6d-23e4-4a1a-a34d-3cf646ec6b0e', -- GCSE Mock Exams #1, 2 to 13 Nov 2026
    '68d38e94-b580-4944-8a1f-030c29d8effa', -- Year 11 Parents' Evening & Reports, 3 Dec 2026
    'de65c374-1eb1-4ea5-93ea-5d9bda9355aa', -- Christmas Holiday, 19 Dec 2026 to 4 Jan 2027
    'a4acfd8d-30ce-466d-b6d9-0a4c190083ee', -- School INSET Day, 4 Jan 2027
    '62f321c4-578f-459c-a177-78690caf1895', -- GCSE Mock Exams #2, 8 to 26 Feb 2027
    '7e47ad07-b3a7-4185-a394-280c5590e18d', -- February Half Term, 13 to 21 Feb 2027
    'f43a71f0-79dd-407d-98fe-270b5ca0ed12', -- Year 11 Parents' Evening & Reports, 18 Mar 2027
    '8a307442-67d2-46fd-845f-5ab8954972a3', -- Easter Holiday, 26 Mar to 11 Apr 2027
    '943e511a-1122-4fbc-98ac-08e419a693aa', -- GCSE Exams Begin, 10 May 2027
    'a8be114d-e441-4ca7-9057-704fe7d62cdf', -- May Half Term, 29 May to 6 Jun 2027
    '05f51d55-94da-4803-83ab-b32fead38668', -- Last GCSE Exam, 18 Jun 2027
    '1c03530e-10dc-41b2-825b-5f6fbc13c88c', -- GCSE Contingency Day, Keep Free, 23 Jun 2027
    'f8a51d0a-45fb-41cc-b5d4-ca53c9988ea8', -- Year 11 Leavers' Assembly / Final School Day, 24 Jun 2027
    '87850b96-4956-4fe4-86ac-171976df7836', -- Finished School / Summer, 25 Jun 2027
    '805cb452-f9e7-40e4-bc8d-91834e628cfb', -- Year 11 Prom Week, Date TBC, 28 Jun to 2 Jul 2027
    'ecc5dfb2-b086-4277-a0c7-a8f7f57c0b52'  -- GCSE Results Day, 19 Aug 2027
  );

  ALTER TABLE public.calendar_notes ENABLE TRIGGER queue_calendar_note_google_sync;
END
$$;
