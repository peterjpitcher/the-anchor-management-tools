-- Create booking_reminders table to track sent reminders
CREATE TABLE IF NOT EXISTS public.booking_reminders (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    booking_id uuid NOT NULL REFERENCES public.bookings(id) ON DELETE CASCADE,
    reminder_type text NOT NULL CHECK (reminder_type IN ('24_hour', '7_day', '1_hour', '12_hour', 'custom')),
    sent_at timestamptz DEFAULT now() NOT NULL,
    message_id uuid REFERENCES public.messages(id) ON DELETE SET NULL,
    created_at timestamptz DEFAULT now() NOT NULL,
    
    -- Prevent duplicate reminders for the same booking and type
    CONSTRAINT unique_booking_reminder UNIQUE (booking_id, reminder_type)
);

-- Add indexes for performance
CREATE INDEX idx_booking_reminders_booking_id ON public.booking_reminders(booking_id);
CREATE INDEX idx_booking_reminders_sent_at ON public.booking_reminders(sent_at);

-- Enable RLS
ALTER TABLE public.booking_reminders ENABLE ROW LEVEL SECURITY;

-- Create RLS policies
CREATE POLICY "Service role can manage booking_reminders" ON public.booking_reminders
    FOR ALL USING (auth.role() = 'service_role');

-- Grant permissions
GRANT ALL ON public.booking_reminders TO authenticated;
GRANT ALL ON public.booking_reminders TO service_role;

-- Add comment
COMMENT ON TABLE public.booking_reminders IS 'Tracks which reminders have been sent for each booking to prevent duplicates';
COMMENT ON CONSTRAINT unique_booking_reminder ON public.booking_reminders IS 'Ensures each reminder type is only sent once per booking';