-- Migration: Add Afternoon Tea catering packages
-- Description: Adds Classic Afternoon Tea (£16pp) and Prosecco Afternoon Tea (£22pp)

BEGIN;

INSERT INTO catering_packages (
  name, category, serving_style, cost_per_head, pricing_model,
  minimum_guests, summary, includes, served, good_to_know,
  guest_description, dietary_notes, active, display_order
) VALUES
(
  'Afternoon Tea',
  'food',
  'buffet',
  16.00,
  'per_head',
  20,
  'A refined afternoon tea spread — perfect for baby showers, christenings and smaller celebrations.',
  'Finger sandwiches, scones with clotted cream and jam, miniature cakes and pastries, unlimited tea and coffee.',
  'Laid out on tiered stands for guests to help themselves, with tea and coffee refreshed throughout.',
  'Dietary requirements can be catered for with advance notice. Gluten-free and vegetarian options available.',
  'Treat your guests to a traditional afternoon tea — delicate finger sandwiches, freshly baked scones with clotted cream and jam, and a selection of miniature cakes and pastries, all served with unlimited tea and coffee.',
  'Vegetarian and gluten-free options available on request.',
  true,
  7
),
(
  'Prosecco Afternoon Tea',
  'food',
  'buffet',
  22.00,
  'per_head',
  20,
  'Our classic afternoon tea with a glass of prosecco on arrival — ideal for celebrations.',
  'Glass of prosecco on arrival, finger sandwiches, scones with clotted cream and jam, miniature cakes and pastries, unlimited tea and coffee.',
  'Prosecco served on arrival, then afternoon tea laid out on tiered stands with tea and coffee refreshed throughout.',
  'Upgrade to Champagne available on request. Mocktail alternatives available for non-drinkers. Dietary requirements can be catered for with advance notice.',
  'Add a touch of fizz to your celebration — welcome your guests with a glass of prosecco before enjoying a full afternoon tea spread of finger sandwiches, scones with clotted cream and jam, and miniature cakes and pastries.',
  'Vegetarian and gluten-free options available on request. Non-alcoholic alternative available.',
  true,
  8
);

COMMIT;
