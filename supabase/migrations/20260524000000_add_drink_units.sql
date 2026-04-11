-- Add drink-specific units to menu_unit enum
ALTER TYPE menu_unit ADD VALUE IF NOT EXISTS 'pint';
ALTER TYPE menu_unit ADD VALUE IF NOT EXISTS 'measure';
ALTER TYPE menu_unit ADD VALUE IF NOT EXISTS 'glass';
