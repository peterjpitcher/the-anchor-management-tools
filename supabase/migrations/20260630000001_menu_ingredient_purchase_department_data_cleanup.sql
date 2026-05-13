-- Capture current ingredient department/data cleanups used for allergen validation.

UPDATE menu_ingredients
SET purchase_department = 'bar'
WHERE purchase_department <> 'bar'
  AND lower(name) <> 'bamboo stick'
  AND lower(name) NOT IN (
    'tesco lemons 4 pack',
    'tesco limes minimum 5 pack',
    'tesco whole cucumber each'
  )
  AND (
    lower(name) LIKE '%(keg)%'
    OR lower(name) LIKE '%(bottle)%'
    OR lower(name) LIKE '%(70cl)%'
    OR lower(name) LIKE '%(1.5l)%'
    OR lower(name) LIKE '%(cocktail mix)%'
    OR lower(name) LIKE '%(stock)%'
    OR lower(name) LIKE '%post-mix%'
    OR lower(name) LIKE '%tesco green tea%'
    OR lower(name) LIKE '%tesco lemon & ginger%'
    OR lower(name) LIKE '%tesco peppermint%'
    OR lower(name) LIKE '%tesco red berries%'
  );

UPDATE menu_ingredients
SET purchase_department = 'other'
WHERE lower(name) = 'bamboo stick';

UPDATE menu_ingredients
SET supplier_name = 'Costco'
WHERE lower(name) = 'salt & chilli squid'
  AND supplier_name IS DISTINCT FROM 'Costco';

UPDATE menu_ingredients
SET supplier_name = 'Booker'
WHERE lower(name) = 'tartare sauce'
  AND supplier_name IS DISTINCT FROM 'Booker';

UPDATE menu_ingredients
SET is_active = false
WHERE lower(name) = 'vegetable burger patty'
  AND is_active IS DISTINCT FROM false;
