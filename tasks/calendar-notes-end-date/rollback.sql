-- Rollback for supabase/migrations/20261005110211_calendar_notes_end_date_required.sql
--
-- Step 1 is the whole rollback in practice: it makes end_date optional again.
--
-- Step 2 puts the 53 backfilled rows back to having no end date. It is only
-- there for an exact restore. A NULL and an end date equal to note_date mean
-- the same thing to every reader, and NULL is what hid these notes from the
-- rota, so think twice before running it. It skips any of the 53 that has
-- since been given a different end date. It cannot restore updated_at, which
-- was 2026-08-28 16:00:42.642165+00 on all 53 before the migration.
--
-- The ids were read from production (tfcasgxopxegwrabvwat) on 5 October 2026,
-- before the migration: 53 rows, md5 of the sorted comma-joined list
-- a9e0fc0b5065563b9b458ab217925ccf.

-- Step 1
ALTER TABLE public.calendar_notes
  ALTER COLUMN end_date DROP NOT NULL;

-- Step 2 (optional)
DO $$
BEGIN
  ALTER TABLE public.calendar_notes
    DISABLE TRIGGER queue_calendar_note_google_sync;

  UPDATE public.calendar_notes
  SET end_date = NULL
  WHERE end_date = note_date
    AND id IN (
      '16f9bac0-ba5d-47b6-9efd-95949be432e9','1a69aba1-c165-42dc-922f-d3960ddcdcfe','1c4cd61d-df69-47a8-96f4-e4b4b8f0f99f',
      '1e20a8c7-3138-47e0-ba4d-4dfbe5744896','2067267a-76d0-4c9f-9b64-385d951ffcfb','24cc804f-a394-4aca-872f-05943bd5c7e8',
      '25745d44-c73f-44f5-baab-fa9c30344658','289b4a79-88c7-431c-aeac-69088416fc60','3077a3b9-9d68-475b-8e20-56ad3c248d46',
      '35e9dc23-2198-4be1-a33a-40c8239804a6','36f77344-9c41-4f60-81b2-1321e3f8b1c4','3862014b-9c38-4fee-b8de-8563fac25006',
      '3916e27d-edf0-4167-b22c-278ed36eb4b2','3eb42b42-e12f-47da-beb8-5a1c49d42f76','447198ed-c17e-47ce-82e8-588db06ecaad',
      '4496fa27-04b1-4a94-b708-2b7149d735c7','496b73d8-a973-437e-96c9-626a2bf5ce96','49905cf0-da8d-4656-acb6-00d6e200a953',
      '50cc19c3-847f-47e0-8e19-3d103663eea5','567594c8-1fbb-4c99-8aa8-af3a271a35e5','5903abed-5217-4ade-a151-f72eb3dcd0a6',
      '599632b6-c54b-4d94-a249-ebc09a0d8da9','5c7564b7-479a-457b-b667-8d2864018549','5d7867d7-4655-4409-9e3f-1c2d9f6fbf6a',
      '67ac6ba4-e5c5-4790-9ad2-fbd243d1c49f','6a0975ac-797b-4cd5-b951-c2b4971f2960','6a328576-ed9c-4341-bd1a-350bf61b4114',
      '7769afe9-7d1e-483c-8a5c-7de30eabeb4c','83e2ecd1-9913-4376-aa2c-0a17b5079195','84849239-9f22-42a0-b0bb-3f3ccdb090af',
      '8ab220f0-33e1-45c0-9394-0ea273e590e1','8b621d66-aa90-4b0f-9252-421708b942ca','8b8be6c4-594c-4e5a-8f76-73e5ccff2dec',
      '8c47cb83-a53a-4ab5-b95b-aa57a2e5e8c4','8d5d6f59-7743-4f18-ad93-f65ab422dc0a','9b30176d-1171-4ca5-8032-fc5f148ebd2d',
      '9d41a8de-669c-4079-b829-03dde93d80f7','9d5ce8c4-87be-4e9f-b3f3-61d6f67d554c','9d67c4fc-6ba4-4ec3-ab43-ddef66d91645',
      'b06a77e7-e975-4f34-9ede-d80aecda2533','bcdd6d01-401d-47cb-a490-2dfa51eded25','be5f9052-a74f-4713-bc4b-1a3684062515',
      'bede5833-f8cd-4f66-a9c8-4d2cfe06bd43','c5c8a65d-b140-4ccd-964c-035eb86d146f','cb159a84-9708-4b66-bf2b-aad0652623b2',
      'cf83aa18-bbe3-4205-8655-39e7961c132e','dd4b2182-1dae-40e0-bf3d-1f4237d6f577','e5d44c69-731f-40be-af14-24565d038ef5',
      'e9e8669f-e7dc-44cd-88ad-cfbf5614d4fa','ea75d452-3904-4445-855c-eb909c1fb772','eebd7fef-9d91-4ca4-9ff0-1df20aa47036',
      'fa120507-c57d-41a1-897e-60e5db8cdb94','fc311501-2066-4a24-9445-78c77ad0ec00'
    );

  ALTER TABLE public.calendar_notes
    ENABLE TRIGGER queue_calendar_note_google_sync;
END;
$$;
