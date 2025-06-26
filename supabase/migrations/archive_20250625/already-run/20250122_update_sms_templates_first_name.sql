-- Update SMS templates to use first_name for more personal messages
-- This migration updates the default message templates to use {{first_name}} instead of {{customer_name}}

-- First, check if the table exists and what columns it has
DO $$
DECLARE
    v_column_name text;
    v_variables_type text;
BEGIN
    -- Check if message_templates table exists
    IF EXISTS (SELECT FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'message_templates') THEN
        -- Determine which column name is used for template content
        IF EXISTS (SELECT FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'message_templates' AND column_name = 'template_content') THEN
            v_column_name := 'template_content';
        ELSIF EXISTS (SELECT FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'message_templates' AND column_name = 'content') THEN
            v_column_name := 'content';
        ELSE
            RAISE NOTICE 'No content column found in message_templates table.';
            RETURN;
        END IF;

        -- Get the data type of the variables column
        SELECT data_type INTO v_variables_type
        FROM information_schema.columns 
        WHERE table_schema = 'public' 
        AND table_name = 'message_templates' 
        AND column_name = 'variables';

        -- Update templates based on the variables column type
        IF v_variables_type = 'jsonb' THEN
            -- Handle JSONB type
            IF v_column_name = 'template_content' THEN
                -- Update template_content and jsonb variables
                UPDATE public.message_templates
                SET 
                  template_content = REPLACE(template_content, 'Hi {{customer_name}}', 'Hi {{first_name}}'),
                  variables = CASE 
                    WHEN variables IS NULL THEN '["first_name"]'::jsonb
                    WHEN variables::text LIKE '%customer_name%' THEN 
                      jsonb_set(variables, '{0}', '"first_name"')
                    ELSE variables
                  END
                WHERE 
                  template_content LIKE 'Hi {{customer_name}}%';

                -- Update specific templates
                UPDATE public.message_templates SET
                  template_content = 'Hi {{first_name}}, your booking for {{event_name}} on {{event_date}} at {{event_time}} has been confirmed. We look forward to seeing you!',
                  variables = '["first_name", "event_name", "event_date", "event_time"]'::jsonb
                WHERE template_type = 'booking_confirmation';

                UPDATE public.message_templates SET
                  template_content = 'Hi {{first_name}}, just a reminder that you''re booked for {{event_name}} tomorrow at {{event_time}}. See you soon!',
                  variables = '["first_name", "event_name", "event_time"]'::jsonb
                WHERE template_type = 'booking_reminder_24_hour';

                UPDATE public.message_templates SET
                  template_content = 'Hi {{first_name}}, we''re looking forward to seeing you at {{event_name}} next week on {{event_date}} at {{event_time}}.',
                  variables = '["first_name", "event_name", "event_date", "event_time"]'::jsonb
                WHERE template_type = 'booking_reminder_7_day';
            ELSE
                -- Update content column with jsonb variables
                UPDATE public.message_templates
                SET 
                  content = REPLACE(content, 'Hi {{customer_name}}', 'Hi {{first_name}}'),
                  variables = CASE 
                    WHEN variables IS NULL THEN '["first_name"]'::jsonb
                    WHEN variables::text LIKE '%customer_name%' THEN 
                      jsonb_set(variables, '{0}', '"first_name"')
                    ELSE variables
                  END
                WHERE 
                  content LIKE 'Hi {{customer_name}}%';
            END IF;

        ELSIF v_variables_type = 'ARRAY' THEN
            -- Handle text[] array type
            IF v_column_name = 'template_content' THEN
                -- Update template_content with array variables
                UPDATE public.message_templates
                SET 
                  template_content = REPLACE(template_content, 'Hi {{customer_name}}', 'Hi {{first_name}}'),
                  variables = CASE 
                    WHEN 'customer_name' = ANY(variables) THEN
                      array_replace(variables, 'customer_name', 'first_name')
                    WHEN NOT ('first_name' = ANY(COALESCE(variables, '{}'::text[]))) THEN
                      array_append(COALESCE(variables, '{}'::text[]), 'first_name')
                    ELSE variables
                  END
                WHERE 
                  template_content LIKE 'Hi {{customer_name}}%';

                -- Update specific templates with text arrays
                UPDATE public.message_templates SET
                  template_content = 'Hi {{first_name}}, your booking for {{event_name}} on {{event_date}} at {{event_time}} has been confirmed. We look forward to seeing you!',
                  variables = ARRAY['first_name', 'event_name', 'event_date', 'event_time']::text[]
                WHERE template_type = 'booking_confirmation';

                UPDATE public.message_templates SET
                  template_content = 'Hi {{first_name}}, just a reminder that you''re booked for {{event_name}} tomorrow at {{event_time}}. See you soon!',
                  variables = ARRAY['first_name', 'event_name', 'event_time']::text[]
                WHERE template_type = 'booking_reminder_24_hour';

                UPDATE public.message_templates SET
                  template_content = 'Hi {{first_name}}, we''re looking forward to seeing you at {{event_name}} next week on {{event_date}} at {{event_time}}.',
                  variables = ARRAY['first_name', 'event_name', 'event_date', 'event_time']::text[]
                WHERE template_type = 'booking_reminder_7_day';
            ELSE
                -- Update content column with array variables
                UPDATE public.message_templates
                SET 
                  content = REPLACE(content, 'Hi {{customer_name}}', 'Hi {{first_name}}'),
                  variables = CASE 
                    WHEN 'customer_name' = ANY(variables) THEN
                      array_replace(variables, 'customer_name', 'first_name')
                    WHEN NOT ('first_name' = ANY(COALESCE(variables, '{}'::text[]))) THEN
                      array_append(COALESCE(variables, '{}'::text[]), 'first_name')
                    ELSE variables
                  END
                WHERE 
                  content LIKE 'Hi {{customer_name}}%';
            END IF;
        END IF;
        
        -- Add comment explaining the change
        COMMENT ON TABLE public.message_templates IS 'Stores reusable message templates with variable substitution. Templates support both {{customer_name}} for full name and {{first_name}} for personalized messages.';
    ELSE
        RAISE NOTICE 'message_templates table does not exist yet. Skipping template updates.';
    END IF;
END $$;