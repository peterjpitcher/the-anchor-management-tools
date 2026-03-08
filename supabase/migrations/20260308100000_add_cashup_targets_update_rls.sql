-- Add missing RLS policies for cashup_targets
-- UPDATE policy is required for setWeeklyTargets which uses UPSERT (UPDATE on conflict)
CREATE POLICY "Staff can update cashup targets"
  ON cashup_targets FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- DELETE policy for future administrative use
CREATE POLICY "Staff can delete cashup targets"
  ON cashup_targets FOR DELETE
  TO authenticated
  USING (true);
