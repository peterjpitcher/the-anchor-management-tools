-- Keep menu descriptions aligned with the Bangkok burger ingredient.

UPDATE menu_dishes
SET
  description = 'Bangkok Bad Boy vegetable burger in a soft floured bap with butterhead salad and tomato, served with chips. Add mild cheddar, crispy bacon, a hash brown, or battered onion rings. Choose your chips: straight-cut, crispy steak-cut, sweet potato fries, or cheesy.',
  updated_at = NOW()
WHERE slug = 'vegetable-burger';

UPDATE menu_dishes
SET
  description = 'Bangkok Bad Boy vegetable burger stacked in a soft floured bap with butterhead salad, tomato, and a battered onion ring, served with chips. Add mild cheddar, crispy bacon, or a hash brown. Pick your chips: straight-cut, crispy steak-cut, sweet potato fries, or cheesy.',
  updated_at = NOW()
WHERE slug = 'veggie-stack';
