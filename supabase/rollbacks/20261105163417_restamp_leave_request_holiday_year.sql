-- Rollback for 20261105163417_restamp_leave_request_holiday_year.sql.
-- Puts the 23 requests back under the April-based holiday year they held before, by id, and only
-- where they still hold the year the migration gave them. No other request is touched.

UPDATE public.leave_requests r
SET holiday_year = v.old_year
FROM (VALUES
  ('2b990c72-a536-4f9a-b132-dbe707d51cb7'::uuid, 2023::smallint, 2024::smallint),
  ('c24e1377-b93c-48b6-be9b-32f20822b4a5'::uuid, 2023::smallint, 2024::smallint),
  ('89e5bcda-115c-4a5c-b341-de88ddda9156'::uuid, 2023::smallint, 2024::smallint),
  ('373e326d-0939-44d2-98f4-605fb5f3d377'::uuid, 2024::smallint, 2025::smallint),
  ('47512527-71c4-4a8f-a93e-d314d73d91d8'::uuid, 2024::smallint, 2025::smallint),
  ('0a868e41-cac5-4c39-b1f0-24a1e365eab1'::uuid, 2024::smallint, 2025::smallint),
  ('150c9a57-1715-40c6-92d9-74df5060ff43'::uuid, 2024::smallint, 2025::smallint),
  ('2a68184a-dfaa-4599-aab8-b24747a97303'::uuid, 2024::smallint, 2025::smallint),
  ('8204c570-37d2-4b6a-85cd-b9a10d40a669'::uuid, 2024::smallint, 2025::smallint),
  ('6c1d2360-97ed-4e75-a720-3eb7f3d86b57'::uuid, 2024::smallint, 2025::smallint),
  ('c54b1465-c48d-4c88-bc4c-f36b9641c0d4'::uuid, 2024::smallint, 2025::smallint),
  ('11eb5f38-e9b6-41be-a386-1e59e17e80e9'::uuid, 2024::smallint, 2025::smallint),
  ('54ca7557-99c4-4de5-9b02-b7d11a705e8e'::uuid, 2024::smallint, 2025::smallint),
  ('45d3a8af-3894-452a-a67f-e4f58faa8616'::uuid, 2024::smallint, 2025::smallint),
  ('a2a212d2-aecc-4571-856a-bf029324106a'::uuid, 2025::smallint, 2026::smallint),
  ('18c0f5f9-5d71-470d-86cd-936c16ea8743'::uuid, 2025::smallint, 2026::smallint),
  ('9f44800b-addf-4503-b1bd-71ede86ba01c'::uuid, 2025::smallint, 2026::smallint),
  ('c8756115-1635-4db0-be4c-af569efbd4d8'::uuid, 2025::smallint, 2026::smallint),
  ('6971287c-6434-413c-ab90-99c7c9ac5cb0'::uuid, 2025::smallint, 2026::smallint),
  ('788bf817-777e-4b6f-9911-ae5f5a5953ce'::uuid, 2025::smallint, 2026::smallint),
  ('35b0963b-8b67-4680-abc0-83d188b152ca'::uuid, 2025::smallint, 2026::smallint),
  ('c852b8bc-8a8b-4b47-9cad-18769f230634'::uuid, 2025::smallint, 2026::smallint),
  ('4bd094e4-7f70-4008-9af5-dbe7e0f4aa22'::uuid, 2025::smallint, 2026::smallint)
) AS v(id, old_year, new_year)
WHERE r.id = v.id
  AND r.holiday_year = v.new_year;
