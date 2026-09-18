SELECT fixture_throws(
  $q$UPDATE private_booking_items SET unit_price=830 WHERE booking_id='c28527fe-a373-460d-85a8-e509b78d6eba'$q$,
  'Resolve the linked invoice'
);
SELECT fixture_throws(
  $q$INSERT INTO private_booking_items(booking_id,item_type,description,unit_price) VALUES('c28527fe-a373-460d-85a8-e509b78d6eba','other','Fixture charged room',1)$q$,
  'Resolve the linked invoice'
);
SELECT fixture_throws(
  $q$DELETE FROM private_booking_items WHERE booking_id='c28527fe-a373-460d-85a8-e509b78d6eba' AND unit_price=829$q$,
  'Resolve the linked invoice'
);

INSERT INTO private_booking_items(id,booking_id,item_type,description,quantity,unit_price,vat_rate)
VALUES('00000000-0000-0000-0000-000000000032','c28527fe-a373-460d-85a8-e509b78d6eba','other','Fixture free room',1,0,20);
UPDATE private_booking_items
SET quantity=2, vat_rate=0
WHERE id='00000000-0000-0000-0000-000000000032';
SELECT fixture_assert(
  (SELECT line_total=0 FROM private_booking_items WHERE id='00000000-0000-0000-0000-000000000032'),
  'zero-value booking item remains editable'
);
DELETE FROM private_booking_items
WHERE id='00000000-0000-0000-0000-000000000032';
SELECT fixture_assert(
  (SELECT count(*)=0 FROM private_booking_items WHERE id='00000000-0000-0000-0000-000000000032'),
  'zero-value booking item remains removable'
);

SELECT 'PASS zero-value linked booking items remain editable while charged changes stay blocked';
