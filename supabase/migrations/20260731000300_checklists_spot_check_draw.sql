-- Atomic daily spot-check draw (spec section 11). One advisory lock per business date makes
-- the draw sticky and race-free (two devices opening the tab get the same pair). Weighted
-- sampling without replacement via Efraimidis-Spirakis: key = random()^(1/weight), take the
-- largest keys; weight = 1 / (1 + checks of the same template in the last 14 days), so a
-- rarely-checked template is more likely to be drawn. Supports top-up: if fewer than p_count
-- rows exist, it draws the remainder (draw_number continues from the current max).
CREATE OR REPLACE FUNCTION public.draw_daily_spot_checks(p_business_date date, p_count int)
RETURNS SETOF public.checklist_spot_checks
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_existing int;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('checklist_spot_draw:' || p_business_date::text));

  SELECT count(*) INTO v_existing
  FROM public.checklist_spot_checks
  WHERE business_date = p_business_date;

  IF v_existing < p_count THEN
    INSERT INTO public.checklist_spot_checks
      (instance_id, business_date, draw_number, checked_employee_id, drawn_at, state)
    SELECT c.id,
           p_business_date,
           v_existing + (row_number() OVER (ORDER BY c.k DESC))::int,
           c.completed_by_employee_id,
           now(),
           'drawn'
    FROM (
      -- Efraimidis-Spirakis weighted sampling: key = random()^(1/weight), take the largest
      -- keys. weight = 1/(1+recent checks), so 1/weight = (1 + recent checks). A rarely-checked
      -- template (low cnt) gets a key nearer 1 and is more likely drawn (spec F-21).
      SELECT i.id,
             i.completed_by_employee_id,
             power(random(), 1.0 + coalesce(rc.cnt, 0)) AS k
      FROM public.checklist_task_instances i
      LEFT JOIN (
        SELECT ti.template_id, count(*) AS cnt
        FROM public.checklist_spot_checks sc
        JOIN public.checklist_task_instances ti ON ti.id = sc.instance_id
        WHERE sc.business_date > p_business_date - 14
        GROUP BY ti.template_id
      ) rc ON rc.template_id = i.template_id
      WHERE i.business_date = p_business_date
        AND i.state = 'done'
        AND i.is_spot_checkable = true
        AND i.completed_by_employee_id IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM public.checklist_spot_checks x WHERE x.instance_id = i.id
        )
      ORDER BY k DESC
      LIMIT (p_count - v_existing)
    ) c;
  END IF;

  RETURN QUERY
    SELECT * FROM public.checklist_spot_checks
    WHERE business_date = p_business_date
    ORDER BY draw_number;
END;
$$;

REVOKE ALL ON FUNCTION public.draw_daily_spot_checks(date, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.draw_daily_spot_checks(date, int) TO service_role;
