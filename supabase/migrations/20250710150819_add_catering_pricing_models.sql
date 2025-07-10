-- Description: Add pricing_model to catering_packages to support both per-head and total-value pricing
-- This allows pizza catering to be priced as a total value rather than per guest

-- First, let's add pizza to the package_type enum if it doesn't exist
-- We need to check the current constraint and update it
ALTER TABLE public.catering_packages 
DROP CONSTRAINT IF EXISTS catering_packages_package_type_check;

ALTER TABLE public.catering_packages 
ADD CONSTRAINT catering_packages_package_type_check 
CHECK (package_type = ANY (ARRAY['buffet'::text, 'sit-down'::text, 'canapes'::text, 'drinks'::text, 'pizza'::text, 'other'::text]));

-- Add pricing_model column with default 'per_head' for backward compatibility
ALTER TABLE public.catering_packages 
ADD COLUMN IF NOT EXISTS pricing_model text DEFAULT 'per_head' 
CHECK (pricing_model IN ('per_head', 'total_value'));

-- Add comment to explain the pricing model
COMMENT ON COLUMN public.catering_packages.pricing_model IS 'Pricing model: per_head = price per guest, total_value = fixed total price';

-- Update the description comment on cost_per_head to reflect dual purpose
COMMENT ON COLUMN public.catering_packages.cost_per_head IS 'Per-head cost when pricing_model=per_head, or total fixed price when pricing_model=total_value';

-- Create index for efficient filtering by package type
CREATE INDEX IF NOT EXISTS idx_catering_packages_package_type ON public.catering_packages(package_type);

-- Create index for efficient filtering by pricing model
CREATE INDEX IF NOT EXISTS idx_catering_packages_pricing_model ON public.catering_packages(pricing_model);

-- Insert example pizza packages (commented out - uncomment if you want sample data)
-- INSERT INTO public.catering_packages (name, description, package_type, cost_per_head, minimum_guests, pricing_model, dietary_notes, active, display_order)
-- VALUES 
-- ('Pizza Selection - Small', 'Selection of pizzas for small groups', 'pizza', 50.00, 1, 'total_value', 'Vegetarian and vegan options available', true, 100),
-- ('Pizza Selection - Medium', 'Selection of pizzas for medium groups', 'pizza', 100.00, 1, 'total_value', 'Vegetarian and vegan options available', true, 101),
-- ('Pizza Selection - Large', 'Selection of pizzas for large groups', 'pizza', 150.00, 1, 'total_value', 'Vegetarian and vegan options available', true, 102);