-- =============================================================
-- Migration: Combine same-day mileage trips & fix expense data
-- =============================================================
-- 1. Fix expense justifications (Yasmin, Two Rivers Car Park)
-- 2. Cache inter-destination distances for multi-stop routes
-- 3. Combine same-day single-destination trips into multi-stop round trips
-- =============================================================

-- -------------------------------------------------------
-- Part 1: Expense fixes
-- -------------------------------------------------------

-- Yasmin: Cleaner → Cleaning
UPDATE public.expenses SET justification = 'Cleaning'
WHERE company_ref = 'Yasmin' AND justification = 'Cleaner';

-- Two Rivers Car Park: empty justification → Parking
UPDATE public.expenses SET justification = 'Parking'
WHERE company_ref = 'Two Rivers Car Park' AND (justification = '' OR justification IS NULL);

-- -------------------------------------------------------
-- Part 2 & 3: Cache distances + combine same-day trips
-- -------------------------------------------------------
DO $$
DECLARE
  v_anchor   UUID;
  v_tesco    UUID;
  v_bookers  UUID;
  v_two_rivers UUID;
  v_ikea     UUID;
  v_windsor  UUID;
  v_costco   UUID;
  v_bq_hayes UUID;
  v_westfield UUID;
  v_trip_id  UUID;
  v_total    NUMERIC(8,1);
BEGIN
  -- Look up all destination IDs once
  SELECT id INTO v_anchor     FROM public.mileage_destinations WHERE is_home_base = TRUE;
  SELECT id INTO v_tesco      FROM public.mileage_destinations WHERE name = 'Tesco - Ashford';
  SELECT id INTO v_bookers    FROM public.mileage_destinations WHERE name = 'Bookers';
  SELECT id INTO v_two_rivers FROM public.mileage_destinations WHERE name = 'Two Rivers Car Park';
  SELECT id INTO v_ikea       FROM public.mileage_destinations WHERE name = 'Ikea Reading';
  SELECT id INTO v_windsor    FROM public.mileage_destinations WHERE name = 'Windsor Car Park';
  SELECT id INTO v_costco     FROM public.mileage_destinations WHERE name = 'Costco';
  SELECT id INTO v_bq_hayes   FROM public.mileage_destinations WHERE name = 'B&Q Hayes';
  SELECT id INTO v_westfield  FROM public.mileage_destinations WHERE name = 'Westfield';

  -- -------------------------------------------------------
  -- Part 2: Insert inter-destination distances
  -- -------------------------------------------------------
  INSERT INTO public.mileage_destination_distances (from_destination_id, to_destination_id, miles)
  VALUES
    (LEAST(v_tesco, v_bookers),      GREATEST(v_tesco, v_bookers),      4.1),
    (LEAST(v_tesco, v_two_rivers),   GREATEST(v_tesco, v_two_rivers),   2.4),
    (LEAST(v_two_rivers, v_ikea),    GREATEST(v_two_rivers, v_ikea),    34.0),
    (LEAST(v_two_rivers, v_windsor), GREATEST(v_two_rivers, v_windsor), 7.2),
    (LEAST(v_costco, v_tesco),       GREATEST(v_costco, v_tesco),       5.1),
    (LEAST(v_costco, v_bookers),     GREATEST(v_costco, v_bookers),     3.4),
    (LEAST(v_tesco, v_bq_hayes),     GREATEST(v_tesco, v_bq_hayes),     8.4),
    (LEAST(v_westfield, v_two_rivers), GREATEST(v_westfield, v_two_rivers), 18.7),
    (LEAST(v_two_rivers, v_bookers), GREATEST(v_two_rivers, v_bookers), 4.8),
    (LEAST(v_costco, v_two_rivers),  GREATEST(v_costco, v_two_rivers),  5.0)
  ON CONFLICT (from_destination_id, to_destination_id) DO UPDATE SET miles = EXCLUDED.miles;

  -- -------------------------------------------------------
  -- Part 3: Combine same-day trips into multi-stop round trips
  -- Each block: delete old trips (CASCADE deletes legs), insert combined trip + legs
  -- -------------------------------------------------------

  -- === 2024-01-02: Anchor → Tesco (1.7) → Bookers (4.1) → Anchor (6.8) = 12.6 ===
  DELETE FROM public.mileage_trips WHERE trip_date = '2024-01-02' AND source = 'manual';
  v_total := 12.6;
  INSERT INTO public.mileage_trips (trip_date, description, total_miles, miles_at_standard_rate, miles_at_reduced_rate, amount_due, source)
  VALUES ('2024-01-02', 'Tesco - Ashford, Bookers', v_total, v_total, 0, ROUND(v_total * 0.45, 2), 'manual')
  RETURNING id INTO v_trip_id;
  INSERT INTO public.mileage_trip_legs (trip_id, leg_order, from_destination_id, to_destination_id, miles) VALUES
    (v_trip_id, 1, v_anchor, v_tesco, 1.7),
    (v_trip_id, 2, v_tesco, v_bookers, 4.1),
    (v_trip_id, 3, v_bookers, v_anchor, 6.8);

  -- === 2024-01-20: Anchor → Two Rivers (3.7) → Ikea (34.0) → Two Rivers (34.0) → Anchor (3.7) = 75.4 ===
  DELETE FROM public.mileage_trips WHERE trip_date = '2024-01-20' AND source = 'manual';
  v_total := 75.4;
  INSERT INTO public.mileage_trips (trip_date, description, total_miles, miles_at_standard_rate, miles_at_reduced_rate, amount_due, source)
  VALUES ('2024-01-20', 'Two Rivers Car Park, Ikea Reading, Two Rivers Car Park', v_total, v_total, 0, ROUND(v_total * 0.45, 2), 'manual')
  RETURNING id INTO v_trip_id;
  INSERT INTO public.mileage_trip_legs (trip_id, leg_order, from_destination_id, to_destination_id, miles) VALUES
    (v_trip_id, 1, v_anchor, v_two_rivers, 3.7),
    (v_trip_id, 2, v_two_rivers, v_ikea, 34.0),
    (v_trip_id, 3, v_ikea, v_two_rivers, 34.0),
    (v_trip_id, 4, v_two_rivers, v_anchor, 3.7);

  -- === 2024-01-29: Anchor → Tesco (1.7) → Bookers (4.1) → Anchor (6.8) = 12.6 ===
  DELETE FROM public.mileage_trips WHERE trip_date = '2024-01-29' AND source = 'manual';
  v_total := 12.6;
  INSERT INTO public.mileage_trips (trip_date, description, total_miles, miles_at_standard_rate, miles_at_reduced_rate, amount_due, source)
  VALUES ('2024-01-29', 'Tesco - Ashford, Bookers', v_total, v_total, 0, ROUND(v_total * 0.45, 2), 'manual')
  RETURNING id INTO v_trip_id;
  INSERT INTO public.mileage_trip_legs (trip_id, leg_order, from_destination_id, to_destination_id, miles) VALUES
    (v_trip_id, 1, v_anchor, v_tesco, 1.7),
    (v_trip_id, 2, v_tesco, v_bookers, 4.1),
    (v_trip_id, 3, v_bookers, v_anchor, 6.8);

  -- === 2024-01-30: Anchor → Two Rivers (3.7) → Windsor (7.2) → Anchor (8.8) = 19.7 ===
  DELETE FROM public.mileage_trips WHERE trip_date = '2024-01-30' AND source = 'manual';
  v_total := 19.7;
  INSERT INTO public.mileage_trips (trip_date, description, total_miles, miles_at_standard_rate, miles_at_reduced_rate, amount_due, source)
  VALUES ('2024-01-30', 'Two Rivers Car Park, Windsor Car Park', v_total, v_total, 0, ROUND(v_total * 0.45, 2), 'manual')
  RETURNING id INTO v_trip_id;
  INSERT INTO public.mileage_trip_legs (trip_id, leg_order, from_destination_id, to_destination_id, miles) VALUES
    (v_trip_id, 1, v_anchor, v_two_rivers, 3.7),
    (v_trip_id, 2, v_two_rivers, v_windsor, 7.2),
    (v_trip_id, 3, v_windsor, v_anchor, 8.8);

  -- === 2024-02-01: Anchor → Costco (1.2) → Tesco (5.1) → Bookers (4.1) → Anchor (6.8) = 17.2 ===
  DELETE FROM public.mileage_trips WHERE trip_date = '2024-02-01' AND source = 'manual';
  v_total := 17.2;
  INSERT INTO public.mileage_trips (trip_date, description, total_miles, miles_at_standard_rate, miles_at_reduced_rate, amount_due, source)
  VALUES ('2024-02-01', 'Costco, Tesco - Ashford, Bookers', v_total, v_total, 0, ROUND(v_total * 0.45, 2), 'manual')
  RETURNING id INTO v_trip_id;
  INSERT INTO public.mileage_trip_legs (trip_id, leg_order, from_destination_id, to_destination_id, miles) VALUES
    (v_trip_id, 1, v_anchor, v_costco, 1.2),
    (v_trip_id, 2, v_costco, v_tesco, 5.1),
    (v_trip_id, 3, v_tesco, v_bookers, 4.1),
    (v_trip_id, 4, v_bookers, v_anchor, 6.8);

  -- === 2025-10-01: Tesco x2 — SKIP (keep both as potentially legitimate) ===

  -- === 2025-10-16: Anchor → Tesco (1.7) → Two Rivers (2.4) → Anchor (3.7) = 7.8 ===
  DELETE FROM public.mileage_trips WHERE trip_date = '2025-10-16' AND source = 'manual';
  v_total := 7.8;
  INSERT INTO public.mileage_trips (trip_date, description, total_miles, miles_at_standard_rate, miles_at_reduced_rate, amount_due, source)
  VALUES ('2025-10-16', 'Tesco - Ashford, Two Rivers Car Park', v_total, v_total, 0, ROUND(v_total * 0.45, 2), 'manual')
  RETURNING id INTO v_trip_id;
  INSERT INTO public.mileage_trip_legs (trip_id, leg_order, from_destination_id, to_destination_id, miles) VALUES
    (v_trip_id, 1, v_anchor, v_tesco, 1.7),
    (v_trip_id, 2, v_tesco, v_two_rivers, 2.4),
    (v_trip_id, 3, v_two_rivers, v_anchor, 3.7);

  -- === 2025-10-18: Anchor → Tesco (1.7) → Costco (5.1) → Bookers (3.4) → Anchor (6.8) = 17.0 ===
  DELETE FROM public.mileage_trips WHERE trip_date = '2025-10-18' AND source = 'manual';
  v_total := 17.0;
  INSERT INTO public.mileage_trips (trip_date, description, total_miles, miles_at_standard_rate, miles_at_reduced_rate, amount_due, source)
  VALUES ('2025-10-18', 'Tesco - Ashford, Costco, Bookers', v_total, v_total, 0, ROUND(v_total * 0.45, 2), 'manual')
  RETURNING id INTO v_trip_id;
  INSERT INTO public.mileage_trip_legs (trip_id, leg_order, from_destination_id, to_destination_id, miles) VALUES
    (v_trip_id, 1, v_anchor, v_tesco, 1.7),
    (v_trip_id, 2, v_tesco, v_costco, 5.1),
    (v_trip_id, 3, v_costco, v_bookers, 3.4),
    (v_trip_id, 4, v_bookers, v_anchor, 6.8);

  -- === 2025-10-22: Anchor → Two Rivers (3.7) → Bookers (4.8) → Anchor (6.8) = 15.3 ===
  DELETE FROM public.mileage_trips WHERE trip_date = '2025-10-22' AND source = 'manual';
  v_total := 15.3;
  INSERT INTO public.mileage_trips (trip_date, description, total_miles, miles_at_standard_rate, miles_at_reduced_rate, amount_due, source)
  VALUES ('2025-10-22', 'Two Rivers Car Park, Bookers', v_total, v_total, 0, ROUND(v_total * 0.45, 2), 'manual')
  RETURNING id INTO v_trip_id;
  INSERT INTO public.mileage_trip_legs (trip_id, leg_order, from_destination_id, to_destination_id, miles) VALUES
    (v_trip_id, 1, v_anchor, v_two_rivers, 3.7),
    (v_trip_id, 2, v_two_rivers, v_bookers, 4.8),
    (v_trip_id, 3, v_bookers, v_anchor, 6.8);

  -- === 2025-10-28: Anchor → Tesco (1.7) → Two Rivers (2.4) → Anchor (3.7) = 7.8 ===
  DELETE FROM public.mileage_trips WHERE trip_date = '2025-10-28' AND source = 'manual';
  v_total := 7.8;
  INSERT INTO public.mileage_trips (trip_date, description, total_miles, miles_at_standard_rate, miles_at_reduced_rate, amount_due, source)
  VALUES ('2025-10-28', 'Tesco - Ashford, Two Rivers Car Park', v_total, v_total, 0, ROUND(v_total * 0.45, 2), 'manual')
  RETURNING id INTO v_trip_id;
  INSERT INTO public.mileage_trip_legs (trip_id, leg_order, from_destination_id, to_destination_id, miles) VALUES
    (v_trip_id, 1, v_anchor, v_tesco, 1.7),
    (v_trip_id, 2, v_tesco, v_two_rivers, 2.4),
    (v_trip_id, 3, v_two_rivers, v_anchor, 3.7);

  -- === 2025-11-05: Anchor → Tesco (1.7) → Two Rivers (2.4) → Anchor (3.7) = 7.8 ===
  DELETE FROM public.mileage_trips WHERE trip_date = '2025-11-05' AND source = 'manual';
  v_total := 7.8;
  INSERT INTO public.mileage_trips (trip_date, description, total_miles, miles_at_standard_rate, miles_at_reduced_rate, amount_due, source)
  VALUES ('2025-11-05', 'Tesco - Ashford, Two Rivers Car Park', v_total, v_total, 0, ROUND(v_total * 0.45, 2), 'manual')
  RETURNING id INTO v_trip_id;
  INSERT INTO public.mileage_trip_legs (trip_id, leg_order, from_destination_id, to_destination_id, miles) VALUES
    (v_trip_id, 1, v_anchor, v_tesco, 1.7),
    (v_trip_id, 2, v_tesco, v_two_rivers, 2.4),
    (v_trip_id, 3, v_two_rivers, v_anchor, 3.7);

  -- === 2025-11-06: Anchor → Tesco (1.7) → B&Q Hayes (8.4) → Anchor (17.0) = 27.1 ===
  DELETE FROM public.mileage_trips WHERE trip_date = '2025-11-06' AND source = 'manual';
  v_total := 27.1;
  INSERT INTO public.mileage_trips (trip_date, description, total_miles, miles_at_standard_rate, miles_at_reduced_rate, amount_due, source)
  VALUES ('2025-11-06', 'Tesco - Ashford, B&Q Hayes', v_total, v_total, 0, ROUND(v_total * 0.45, 2), 'manual')
  RETURNING id INTO v_trip_id;
  INSERT INTO public.mileage_trip_legs (trip_id, leg_order, from_destination_id, to_destination_id, miles) VALUES
    (v_trip_id, 1, v_anchor, v_tesco, 1.7),
    (v_trip_id, 2, v_tesco, v_bq_hayes, 8.4),
    (v_trip_id, 3, v_bq_hayes, v_anchor, 17.0);

  -- === 2025-11-07: Anchor → Tesco (1.7) → Bookers (4.1) → Anchor (6.8) = 12.6 ===
  DELETE FROM public.mileage_trips WHERE trip_date = '2025-11-07' AND source = 'manual';
  v_total := 12.6;
  INSERT INTO public.mileage_trips (trip_date, description, total_miles, miles_at_standard_rate, miles_at_reduced_rate, amount_due, source)
  VALUES ('2025-11-07', 'Tesco - Ashford, Bookers', v_total, v_total, 0, ROUND(v_total * 0.45, 2), 'manual')
  RETURNING id INTO v_trip_id;
  INSERT INTO public.mileage_trip_legs (trip_id, leg_order, from_destination_id, to_destination_id, miles) VALUES
    (v_trip_id, 1, v_anchor, v_tesco, 1.7),
    (v_trip_id, 2, v_tesco, v_bookers, 4.1),
    (v_trip_id, 3, v_bookers, v_anchor, 6.8);

  -- === 2025-11-10: Anchor → Two Rivers (3.7) → Westfield (18.7) → Anchor (16.0) = 38.4 ===
  DELETE FROM public.mileage_trips WHERE trip_date = '2025-11-10' AND source = 'manual';
  v_total := 38.4;
  INSERT INTO public.mileage_trips (trip_date, description, total_miles, miles_at_standard_rate, miles_at_reduced_rate, amount_due, source)
  VALUES ('2025-11-10', 'Two Rivers Car Park, Westfield', v_total, v_total, 0, ROUND(v_total * 0.45, 2), 'manual')
  RETURNING id INTO v_trip_id;
  INSERT INTO public.mileage_trip_legs (trip_id, leg_order, from_destination_id, to_destination_id, miles) VALUES
    (v_trip_id, 1, v_anchor, v_two_rivers, 3.7),
    (v_trip_id, 2, v_two_rivers, v_westfield, 18.7),
    (v_trip_id, 3, v_westfield, v_anchor, 16.0);

  -- === 2025-11-13: Anchor → Tesco (1.7) → Two Rivers (2.4) → Bookers (4.8) → Anchor (6.8) = 15.7 ===
  DELETE FROM public.mileage_trips WHERE trip_date = '2025-11-13' AND source = 'manual';
  v_total := 15.7;
  INSERT INTO public.mileage_trips (trip_date, description, total_miles, miles_at_standard_rate, miles_at_reduced_rate, amount_due, source)
  VALUES ('2025-11-13', 'Tesco - Ashford, Two Rivers Car Park, Bookers', v_total, v_total, 0, ROUND(v_total * 0.45, 2), 'manual')
  RETURNING id INTO v_trip_id;
  INSERT INTO public.mileage_trip_legs (trip_id, leg_order, from_destination_id, to_destination_id, miles) VALUES
    (v_trip_id, 1, v_anchor, v_tesco, 1.7),
    (v_trip_id, 2, v_tesco, v_two_rivers, 2.4),
    (v_trip_id, 3, v_two_rivers, v_bookers, 4.8),
    (v_trip_id, 4, v_bookers, v_anchor, 6.8);

  -- === 2025-12-04: Anchor → Two Rivers (3.7) → Ikea (34.0) → Anchor (31.0) = 68.7 ===
  DELETE FROM public.mileage_trips WHERE trip_date = '2025-12-04' AND source = 'manual';
  v_total := 68.7;
  INSERT INTO public.mileage_trips (trip_date, description, total_miles, miles_at_standard_rate, miles_at_reduced_rate, amount_due, source)
  VALUES ('2025-12-04', 'Two Rivers Car Park, Ikea Reading', v_total, v_total, 0, ROUND(v_total * 0.45, 2), 'manual')
  RETURNING id INTO v_trip_id;
  INSERT INTO public.mileage_trip_legs (trip_id, leg_order, from_destination_id, to_destination_id, miles) VALUES
    (v_trip_id, 1, v_anchor, v_two_rivers, 3.7),
    (v_trip_id, 2, v_two_rivers, v_ikea, 34.0),
    (v_trip_id, 3, v_ikea, v_anchor, 31.0);

  -- === 2025-12-05: Anchor → Tesco (1.7) → Bookers (4.1) → Anchor (6.8) = 12.6 ===
  DELETE FROM public.mileage_trips WHERE trip_date = '2025-12-05' AND source = 'manual';
  v_total := 12.6;
  INSERT INTO public.mileage_trips (trip_date, description, total_miles, miles_at_standard_rate, miles_at_reduced_rate, amount_due, source)
  VALUES ('2025-12-05', 'Tesco - Ashford, Bookers', v_total, v_total, 0, ROUND(v_total * 0.45, 2), 'manual')
  RETURNING id INTO v_trip_id;
  INSERT INTO public.mileage_trip_legs (trip_id, leg_order, from_destination_id, to_destination_id, miles) VALUES
    (v_trip_id, 1, v_anchor, v_tesco, 1.7),
    (v_trip_id, 2, v_tesco, v_bookers, 4.1),
    (v_trip_id, 3, v_bookers, v_anchor, 6.8);

  -- === 2025-12-10: Anchor → Costco (1.2) → Two Rivers (5.0) → Tesco (2.4) → Anchor (1.7) = 10.3 ===
  DELETE FROM public.mileage_trips WHERE trip_date = '2025-12-10' AND source = 'manual';
  v_total := 10.3;
  INSERT INTO public.mileage_trips (trip_date, description, total_miles, miles_at_standard_rate, miles_at_reduced_rate, amount_due, source)
  VALUES ('2025-12-10', 'Costco, Two Rivers Car Park, Tesco - Ashford', v_total, v_total, 0, ROUND(v_total * 0.45, 2), 'manual')
  RETURNING id INTO v_trip_id;
  INSERT INTO public.mileage_trip_legs (trip_id, leg_order, from_destination_id, to_destination_id, miles) VALUES
    (v_trip_id, 1, v_anchor, v_costco, 1.2),
    (v_trip_id, 2, v_costco, v_two_rivers, 5.0),
    (v_trip_id, 3, v_two_rivers, v_tesco, 2.4),
    (v_trip_id, 4, v_tesco, v_anchor, 1.7);

  -- === 2025-12-11: Anchor → Costco (1.2) → Bookers (3.4) → Anchor (6.8) = 11.4 ===
  DELETE FROM public.mileage_trips WHERE trip_date = '2025-12-11' AND source = 'manual';
  v_total := 11.4;
  INSERT INTO public.mileage_trips (trip_date, description, total_miles, miles_at_standard_rate, miles_at_reduced_rate, amount_due, source)
  VALUES ('2025-12-11', 'Costco, Bookers', v_total, v_total, 0, ROUND(v_total * 0.45, 2), 'manual')
  RETURNING id INTO v_trip_id;
  INSERT INTO public.mileage_trip_legs (trip_id, leg_order, from_destination_id, to_destination_id, miles) VALUES
    (v_trip_id, 1, v_anchor, v_costco, 1.2),
    (v_trip_id, 2, v_costco, v_bookers, 3.4),
    (v_trip_id, 3, v_bookers, v_anchor, 6.8);

  -- === 2025-12-18: Tesco x2 — SKIP (keep both as potentially legitimate) ===

  -- === 2025-12-24: Anchor → Costco (1.2) → Tesco (5.1) → Anchor (1.7) = 8.0 ===
  DELETE FROM public.mileage_trips WHERE trip_date = '2025-12-24' AND source = 'manual';
  v_total := 8.0;
  INSERT INTO public.mileage_trips (trip_date, description, total_miles, miles_at_standard_rate, miles_at_reduced_rate, amount_due, source)
  VALUES ('2025-12-24', 'Costco, Tesco - Ashford', v_total, v_total, 0, ROUND(v_total * 0.45, 2), 'manual')
  RETURNING id INTO v_trip_id;
  INSERT INTO public.mileage_trip_legs (trip_id, leg_order, from_destination_id, to_destination_id, miles) VALUES
    (v_trip_id, 1, v_anchor, v_costco, 1.2),
    (v_trip_id, 2, v_costco, v_tesco, 5.1),
    (v_trip_id, 3, v_tesco, v_anchor, 1.7);

  -- === 2025-12-30: Anchor → Tesco (1.7) → Two Rivers (2.4) → Anchor (3.7) = 7.8 ===
  DELETE FROM public.mileage_trips WHERE trip_date = '2025-12-30' AND source = 'manual';
  v_total := 7.8;
  INSERT INTO public.mileage_trips (trip_date, description, total_miles, miles_at_standard_rate, miles_at_reduced_rate, amount_due, source)
  VALUES ('2025-12-30', 'Tesco - Ashford, Two Rivers Car Park', v_total, v_total, 0, ROUND(v_total * 0.45, 2), 'manual')
  RETURNING id INTO v_trip_id;
  INSERT INTO public.mileage_trip_legs (trip_id, leg_order, from_destination_id, to_destination_id, miles) VALUES
    (v_trip_id, 1, v_anchor, v_tesco, 1.7),
    (v_trip_id, 2, v_tesco, v_two_rivers, 2.4),
    (v_trip_id, 3, v_two_rivers, v_anchor, 3.7);

END;
$$;
