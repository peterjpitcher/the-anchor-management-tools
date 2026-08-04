-- Add petits fours as a private-booking dessert option.
-- Prices in catering_packages are stored net of VAT.

BEGIN;

INSERT INTO public.catering_packages (
  name,
  summary,
  includes,
  served,
  good_to_know,
  guest_description,
  serving_style,
  category,
  pricing_model,
  cost_per_head,
  minimum_guests,
  dietary_notes,
  vat_rate,
  requires_waiver,
  requires_allergy_capture,
  seasonal,
  active,
  display_order
) VALUES (
  'Petits Fours',
  'A selection of bite-sized petits fours — a perfect way to treat groups of guests.',
  'A selection of petits fours, portioned for the booked guest count.',
  'Presented on sharing boards for groups of guests.',
  'Available for a minimum of 30 guests.',
  'Treat your guests to a selection of bite-sized petits fours, presented on sharing boards for the group to enjoy.',
  'other',
  'addon',
  'per_head',
  5.00,
  30,
  'Please provide allergy and dietary requirements in advance.',
  20.00,
  false,
  true,
  false,
  true,
  70
)
ON CONFLICT (name) DO UPDATE SET
  summary = EXCLUDED.summary,
  includes = EXCLUDED.includes,
  served = EXCLUDED.served,
  good_to_know = EXCLUDED.good_to_know,
  guest_description = EXCLUDED.guest_description,
  serving_style = EXCLUDED.serving_style,
  category = EXCLUDED.category,
  pricing_model = EXCLUDED.pricing_model,
  cost_per_head = EXCLUDED.cost_per_head,
  minimum_guests = EXCLUDED.minimum_guests,
  dietary_notes = EXCLUDED.dietary_notes,
  vat_rate = EXCLUDED.vat_rate,
  requires_waiver = EXCLUDED.requires_waiver,
  requires_allergy_capture = EXCLUDED.requires_allergy_capture,
  seasonal = EXCLUDED.seasonal,
  active = EXCLUDED.active,
  display_order = EXCLUDED.display_order;

COMMIT;
