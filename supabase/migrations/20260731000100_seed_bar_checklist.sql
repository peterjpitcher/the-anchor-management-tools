-- Seed: The Anchor bar checklist (department = 'bar').
-- Source content: tasks/checklists-discovery/bar-checklist.md
-- Seed values approved in tasks/checklists-discovery/decisions.md, decisions 26 and 27.
--
-- Ships DORMANT: every template is is_active = false (Phase 2 flips them on). version = 1.
-- Source typos are corrected here (they become records staff read daily). Closing item 16
-- drops its hard-coded machine-off times (decision 26); the 2-hourly cleaning check is a
-- single every-2-hours template, not fixed 18:00/20:00/22:00 rows (decisions 25 and 26);
-- "Freshen Pub Cleanliness" is deliberately left off (decision 27, S16).
--
-- Depends on 20260731000000_checklists_foundation.sql (tables + CHECK constraints).

DO $$
DECLARE
  v_opening  uuid;
  v_closing  uuid;
  v_readings uuid;
  v_cleaning uuid;
  v_periodic uuid;
BEGIN
  ----------------------------------------------------------------------------
  -- 1. Checklists (5 rows, all department = 'bar', is_active = true)
  ----------------------------------------------------------------------------
  INSERT INTO public.checklists (name, description, department, sort_order, is_active)
  VALUES ('Bar Opening', 'Daily opening tasks for the bar, due at open.', 'bar', 1, true)
  RETURNING id INTO v_opening;

  INSERT INTO public.checklists (name, description, department, sort_order, is_active)
  VALUES ('Bar Daily Readings', 'Daily fridge and cellar temperature readings.', 'bar', 2, true)
  RETURNING id INTO v_readings;

  INSERT INTO public.checklists (name, description, department, sort_order, is_active)
  VALUES ('Bar Cleaning Checks', 'Cleaning check that recurs every two hours through service.', 'bar', 3, true)
  RETURNING id INTO v_cleaning;

  INSERT INTO public.checklists (name, description, department, sort_order, is_active)
  VALUES ('Bar Closing', 'Daily closing tasks for the bar, due at close.', 'bar', 4, true)
  RETURNING id INTO v_closing;

  INSERT INTO public.checklists (name, description, department, sort_order, is_active)
  VALUES ('Bar Periodic', 'Bar tasks on a floating cadence (more than weekly, less than daily), plus the weekly pool-table spray.', 'bar', 5, true)
  RETURNING id INTO v_periodic;

  ----------------------------------------------------------------------------
  -- 2. Bar Daily Readings (3 templates, value required, degC)
  --    calendar / daily / anchor=open / requires_value / spot-checkable
  ----------------------------------------------------------------------------
  INSERT INTO public.checklist_task_templates
    (checklist_id, title, sort_order, schedule_kind, freq, anchor,
     requires_value, value_unit, value_min, value_max, is_spot_checkable, is_active, version)
  VALUES
    (v_readings, 'Cellar Cooler',        1, 'calendar', 'daily', 'open', true, 'degC', 10.0, 14.0, true, false, 1),
    (v_readings, 'Left Bottle Fridge',   2, 'calendar', 'daily', 'open', true, 'degC',  0.0,  8.0, true, false, 1),
    (v_readings, 'Right Bottle Fridge',  3, 'calendar', 'daily', 'open', true, 'degC',  0.0,  8.0, true, false, 1);

  ----------------------------------------------------------------------------
  -- 3. Bar Opening (items 1-18; typos corrected: Cutlery, Condiments)
  --    calendar / daily / anchor=open / spot-checkable
  ----------------------------------------------------------------------------
  INSERT INTO public.checklist_task_templates
    (checklist_id, title, sort_order, schedule_kind, freq, anchor, is_spot_checkable, is_active, version)
  VALUES
    (v_opening, 'All machines switched on and cleaned (all TVs, fruit machine, and jukebox)', 1, 'calendar', 'daily', 'open', true, false, 1),
    (v_opening, 'Hoover Carpet Area', 2, 'calendar', 'daily', 'open', true, false, 1),
    (v_opening, 'Spot Mop throughout floors (blue bucket)', 3, 'calendar', 'daily', 'open', true, false, 1),
    (v_opening, 'Make sure all spaces (inside and out) are clean and tidy (cigarette butts, glasses, etc)', 4, 'calendar', 'daily', 'open', true, false, 1),
    (v_opening, 'Replace Table Numbers and Beer Mats', 5, 'calendar', 'daily', 'open', true, false, 1),
    (v_opening, 'Menus ready (WhatsApp Pete if you need more)', 6, 'calendar', 'daily', 'open', true, false, 1),
    (v_opening, 'Load ice bucket', 7, 'calendar', 'daily', 'open', true, false, 1),
    (v_opening, 'Utensils out (tongs / measures / cocktail equip)', 8, 'calendar', 'daily', 'open', true, false, 1),
    (v_opening, 'Bin liners in all bins (including 2 in the garden)', 9, 'calendar', 'daily', 'open', true, false, 1),
    (v_opening, 'Glasswasher is put together and turned on', 10, 'calendar', 'daily', 'open', true, false, 1),
    (v_opening, 'Draught & post mix nozzles & drip trays set up', 11, 'calendar', 'daily', 'open', true, false, 1),
    (v_opening, 'Bar top clean (not sticky)', 12, 'calendar', 'daily', 'open', true, false, 1),
    (v_opening, 'Bar pumps are clean (not dusty), and font lights are turned on', 13, 'calendar', 'daily', 'open', true, false, 1),
    (v_opening, 'The back bar stocked and clean with no clutter i.e. Red Wine', 14, 'calendar', 'daily', 'open', true, false, 1),
    (v_opening, 'Fill the jug with water', 15, 'calendar', 'daily', 'open', true, false, 1),
    (v_opening, 'Restock Caddies (Mayo, Cutlery Clean, Condiments Clean, Napkins)', 16, 'calendar', 'daily', 'open', true, false, 1),
    (v_opening, 'Open bathroom windows', 17, 'calendar', 'daily', 'open', true, false, 1),
    (v_opening, 'Check Till for Bookings and Place Chalkboards', 18, 'calendar', 'daily', 'open', true, false, 1);

  -- Opening item 19: seasonal (Autumn/Winter only), 01 Oct - 31 Mar
  INSERT INTO public.checklist_task_templates
    (checklist_id, title, sort_order, schedule_kind, freq, anchor, is_spot_checkable,
     season_start, season_end, is_active, version)
  VALUES
    (v_opening, 'Load candles into holders and light at open', 19, 'calendar', 'daily', 'open', true, '10-01', '03-31', false, 1);

  ----------------------------------------------------------------------------
  -- 4. Bar Closing (items 1-21; typos corrected: removed, stripped, cellar,
  --    Draught. Item 16 loses its hard-coded times, decision 26)
  --    calendar / daily / anchor=close / spot-checkable
  ----------------------------------------------------------------------------
  INSERT INTO public.checklist_task_templates
    (checklist_id, title, sort_order, schedule_kind, freq, anchor, is_spot_checkable, is_active, version)
  VALUES
    (v_closing, 'All tables clean and beer mats removed (dispose of rubbish ones)', 1, 'calendar', 'daily', 'close', true, false, 1),
    (v_closing, 'All food items behind the bar (including juice) date dotted in the fridge', 2, 'calendar', 'daily', 'close', true, false, 1),
    (v_closing, 'Bottle up including back bar', 3, 'calendar', 'daily', 'close', true, false, 1),
    (v_closing, 'All glassware is washed & on the correct shelves', 4, 'calendar', 'daily', 'close', true, false, 1),
    (v_closing, 'Glasswasher, stripped and cleaned as well as collection tray and basket', 5, 'calendar', 'daily', 'close', true, false, 1),
    (v_closing, 'The front & back bar cleaned', 6, 'calendar', 'daily', 'close', true, false, 1),
    (v_closing, 'Snacks restocked to bar', 7, 'calendar', 'daily', 'close', true, false, 1),
    (v_closing, 'Tongs, board, fruit knife, measurers and shakers all washed up and left to dry', 8, 'calendar', 'daily', 'close', true, false, 1),
    (v_closing, 'The fruit tray washed up and left to dry', 9, 'calendar', 'daily', 'close', true, false, 1),
    (v_closing, 'All bins emptied & bins left without a bag (let the bin air out overnight)', 10, 'calendar', 'daily', 'close', true, false, 1),
    (v_closing, 'All rubbish removed from the building (including from cellar)', 11, 'calendar', 'daily', 'close', true, false, 1),
    (v_closing, 'Cloths, tea towels and bar runners in the washing basket', 12, 'calendar', 'daily', 'close', true, false, 1),
    (v_closing, 'Draught & post mix nozzles removed and left in soda', 13, 'calendar', 'daily', 'close', true, false, 1),
    (v_closing, 'Drip trays cleaned & replaced', 14, 'calendar', 'daily', 'close', true, false, 1),
    (v_closing, 'Sinks cleaned & free of rubbish', 15, 'calendar', 'daily', 'close', true, false, 1),
    (v_closing, 'All machines and music switched off', 16, 'calendar', 'daily', 'close', true, false, 1),
    (v_closing, 'Wash beer mats through glass washer and leave to dry over radiator', 17, 'calendar', 'daily', 'close', true, false, 1),
    (v_closing, 'Sweep and mop behind the bar (blue bucket)', 18, 'calendar', 'daily', 'close', true, false, 1),
    (v_closing, 'Sweep floors throughout', 19, 'calendar', 'daily', 'close', true, false, 1),
    (v_closing, 'Mop, clean and ''Harpic'' both bathrooms (red bucket)', 20, 'calendar', 'daily', 'close', true, false, 1),
    (v_closing, 'Close and lock all windows and doors', 21, 'calendar', 'daily', 'close', true, false, 1);

  ----------------------------------------------------------------------------
  -- 5. Bar Cleaning Checks (single template, every 2 hours through service)
  --    calendar / daily / anchor=every / every_hours=2 / spot-checkable
  ----------------------------------------------------------------------------
  INSERT INTO public.checklist_task_templates
    (checklist_id, title, instruction, sort_order, schedule_kind, freq, anchor, every_hours, is_spot_checkable, is_active, version)
  VALUES
    (v_cleaning, 'Cleaning check',
     'Regular Cleaning Check Points: Toilet (including toilet rolls and paper towels in holders and handwash topped up), Jukebox, Pool Table, Fruit Machine, Till and door push plates.',
     1, 'calendar', 'daily', 'every', 2, true, false, 1);

  ----------------------------------------------------------------------------
  -- 6. Bar Periodic (floating cadence, intervals from decision 27)
  --    floating / anchor=anytime / spot-checkable. first_due_on staggered
  --    across 2026-08-01 .. 2026-08-06 so they do not all fall due on day one.
  ----------------------------------------------------------------------------
  INSERT INTO public.checklist_task_templates
    (checklist_id, title, sort_order, schedule_kind, anchor,
     interval_days, tolerance_days, first_due_on, is_spot_checkable, is_active, version)
  VALUES
    (v_periodic, 'Wipe chairs and tables',                        1, 'floating', 'anytime', 3, 2, DATE '2026-08-01', true, false, 1),
    (v_periodic, 'Wipe pool table and legs',                      2, 'floating', 'anytime', 3, 2, DATE '2026-08-01', true, false, 1),
    (v_periodic, 'Brush pool table',                              3, 'floating', 'anytime', 2, 1, DATE '2026-08-02', true, false, 1),
    (v_periodic, 'Clean glass racks',                             4, 'floating', 'anytime', 5, 2, DATE '2026-08-02', true, false, 1),
    (v_periodic, 'Clean display bottles and shelves',             5, 'floating', 'anytime', 5, 2, DATE '2026-08-03', true, false, 1),
    (v_periodic, 'Window seals and windows',                      6, 'floating', 'anytime', 7, 3, DATE '2026-08-03', true, false, 1),
    (v_periodic, 'Stock rotation',                                7, 'floating', 'anytime', 3, 1, DATE '2026-08-04', true, false, 1),
    (v_periodic, 'Refill caddies',                                8, 'floating', 'anytime', 2, 1, DATE '2026-08-04', true, false, 1),
    (v_periodic, 'Glass clean jukebox',                           9, 'floating', 'anytime', 5, 2, DATE '2026-08-05', true, false, 1),
    (v_periodic, 'Restock fridges snacks bottles and rotate',    10, 'floating', 'anytime', 3, 1, DATE '2026-08-05', true, false, 1),
    (v_periodic, 'Hoover/mop',                                   11, 'floating', 'anytime', 3, 1, DATE '2026-08-06', true, false, 1);

  -- Spray pool table: separate calendar weekly (Mondays), tied to the more
  -- frequent floating "Brush pool table". anchor_date 2026-08-03 is a Monday.
  INSERT INTO public.checklist_task_templates
    (checklist_id, title, sort_order, schedule_kind, freq, by_weekday, anchor_date, anchor, is_spot_checkable, is_active, version)
  VALUES
    (v_periodic, 'Spray pool table', 12, 'calendar', 'weekly', ARRAY[1], DATE '2026-08-03', 'anytime', true, false, 1);
END $$;
