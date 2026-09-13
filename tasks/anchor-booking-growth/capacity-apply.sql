-- Owner-approved dated capacities, 5 September 2026.
-- The staff editor exposes only split capacities, not the total used by booking validation.
-- Preserve every other business field and record old and new capacity in the existing audit log.
DO $$
DECLARE r record; before_row jsonb; after_row jsonb; updated_count integer := 0;
BEGIN
 FOR r IN SELECT * FROM (VALUES
 ('5cdadf74-97c1-4ec0-b495-d369a7304494'::uuid, NULL::integer, 60),
 ('9b78f364-7712-4c92-9b09-ffa9132e37e5'::uuid, NULL::integer, 60),
 ('9d03a427-d331-45bd-91af-142b396b82ae'::uuid, NULL::integer, 60),
 ('e9e84ee8-c59b-4f93-80f6-7e7961a03240'::uuid, NULL::integer, 60),
 ('d81512e7-5e99-48fd-a153-3400c2f6f009'::uuid, NULL::integer, 60),
 ('76ec328b-48f8-47c0-b041-cc405e085deb'::uuid, NULL::integer, 60),
 ('c3ac7e18-e562-4ef8-bea7-cae29f6e96ac'::uuid, NULL::integer, 60),
 ('d52cbd18-d293-4516-beca-e151eaa90180'::uuid, 100::integer, 150),
 ('8acfe965-ade6-4a9f-a666-e90ecdea2b7b'::uuid, NULL::integer, 60),
 ('c3e9fbbd-df4a-41f2-a1c6-8194a5979735'::uuid, NULL::integer, 60),
 ('6e761f65-8b17-4bc9-8a01-d032b77f6a66'::uuid, NULL::integer, 60),
 ('5bd854ce-48e7-4ca8-8e7c-c52cc7ec1e65'::uuid, NULL::integer, 25),
 ('ccbe8b82-15b0-4261-b58e-2ac4d7210e25'::uuid, NULL::integer, 60),
 ('9b8f85f8-c5cc-4956-ad1f-72f569e7fc4a'::uuid, NULL::integer, 60),
 ('b9334958-76b4-4504-a64a-0d47145bd75e'::uuid, NULL::integer, 60)
 ) v(id, expected_capacity, approved_capacity)
 LOOP
  SELECT to_jsonb(e) INTO STRICT before_row FROM public.events e WHERE e.id=r.id FOR UPDATE;
  IF (before_row->>'capacity')::integer IS DISTINCT FROM r.expected_capacity
    OR before_row->>'seated_capacity' IS NOT NULL OR before_row->>'standing_capacity' IS NOT NULL THEN
   RAISE EXCEPTION 'Capacity changed since review for %',r.id;
  END IF;
  UPDATE public.events SET capacity=r.approved_capacity WHERE id=r.id;
  SELECT to_jsonb(e) INTO STRICT after_row FROM public.events e WHERE e.id=r.id;
  IF (before_row - 'capacity') IS DISTINCT FROM (after_row - 'capacity') THEN
   RAISE EXCEPTION 'Unexpected field change for %',r.id;
  END IF;
  INSERT INTO public.audit_logs(operation_type,resource_type,resource_id,operation_status,old_values,new_values,additional_info)
  VALUES('update','event',r.id::text,'success',
    jsonb_build_object('capacity',r.expected_capacity),jsonb_build_object('capacity',r.approved_capacity),
    '{"source":"Codex approved release","owner_approval":"5 September 2026: 60 all reviewed events; Halloween 150; Tasting Night 25","reason":"Total capacity not exposed in staff editor"}'::jsonb);
  updated_count := updated_count+1;
 END LOOP;
 IF updated_count <> 15 THEN RAISE EXCEPTION 'Expected 15 capacity updates'; END IF;
END;
$$;
