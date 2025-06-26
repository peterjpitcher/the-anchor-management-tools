-- Create storage bucket for event images if it doesn't exist
INSERT INTO storage.buckets (id, name, public, avif_autodetection, allowed_mime_types, file_size_limit)
VALUES (
  'event-images',
  'event-images',
  false,
  false,
  ARRAY['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/gif'],
  10485760 -- 10MB limit
)
ON CONFLICT (id) DO UPDATE SET
  allowed_mime_types = ARRAY['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/gif'],
  file_size_limit = 10485760;

-- Storage policies for event images

-- Policy: Authenticated users can upload images
CREATE POLICY "Authenticated users can upload event images"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'event-images' AND
  EXISTS (
    SELECT 1 FROM user_roles ur
    JOIN roles r ON ur.role_id = r.id
    WHERE ur.user_id = auth.uid()
    AND r.name IN ('super_admin', 'manager', 'staff')
  )
);

-- Policy: Authenticated users can update their uploaded images
CREATE POLICY "Users can update their event images"
ON storage.objects FOR UPDATE
TO authenticated
USING (
  bucket_id = 'event-images' AND
  EXISTS (
    SELECT 1 FROM user_roles ur
    JOIN roles r ON ur.role_id = r.id
    WHERE ur.user_id = auth.uid()
    AND r.name IN ('super_admin', 'manager', 'staff')
  )
)
WITH CHECK (
  bucket_id = 'event-images' AND
  EXISTS (
    SELECT 1 FROM user_roles ur
    JOIN roles r ON ur.role_id = r.id
    WHERE ur.user_id = auth.uid()
    AND r.name IN ('super_admin', 'manager', 'staff')
  )
);

-- Policy: Authenticated users can delete images
CREATE POLICY "Users can delete event images"
ON storage.objects FOR DELETE
TO authenticated
USING (
  bucket_id = 'event-images' AND
  EXISTS (
    SELECT 1 FROM user_roles ur
    JOIN roles r ON ur.role_id = r.id
    WHERE ur.user_id = auth.uid()
    AND r.name IN ('super_admin', 'manager', 'staff')
  )
);

-- Policy: Anyone can view event images (public read access)
CREATE POLICY "Public read access for event images"
ON storage.objects FOR SELECT
TO anon, authenticated
USING (bucket_id = 'event-images');

-- Create table to track event image uploads
CREATE TABLE IF NOT EXISTS event_images (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  storage_path TEXT NOT NULL,
  file_name TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  file_size_bytes INTEGER NOT NULL,
  image_type TEXT NOT NULL CHECK (image_type IN ('hero', 'thumbnail', 'poster', 'gallery')),
  display_order INTEGER DEFAULT 0,
  alt_text TEXT,
  caption TEXT,
  uploaded_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create index for faster queries
CREATE INDEX idx_event_images_event_id ON event_images(event_id);
CREATE INDEX idx_event_images_type ON event_images(image_type);

-- RLS policies for event_images table
ALTER TABLE event_images ENABLE ROW LEVEL SECURITY;

-- Anyone can view event images
CREATE POLICY "Anyone can view event images"
ON event_images FOR SELECT
TO anon, authenticated
USING (true);

-- Authenticated users with proper roles can insert
CREATE POLICY "Authorized users can insert event images"
ON event_images FOR INSERT
TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1 FROM user_roles ur
    JOIN roles r ON ur.role_id = r.id
    WHERE ur.user_id = auth.uid()
    AND r.name IN ('super_admin', 'manager', 'staff')
  )
);

-- Authenticated users with proper roles can update
CREATE POLICY "Authorized users can update event images"
ON event_images FOR UPDATE
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM user_roles ur
    JOIN roles r ON ur.role_id = r.id
    WHERE ur.user_id = auth.uid()
    AND r.name IN ('super_admin', 'manager', 'staff')
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM user_roles ur
    JOIN roles r ON ur.role_id = r.id
    WHERE ur.user_id = auth.uid()
    AND r.name IN ('super_admin', 'manager', 'staff')
  )
);

-- Authenticated users with proper roles can delete
CREATE POLICY "Authorized users can delete event images"
ON event_images FOR DELETE
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM user_roles ur
    JOIN roles r ON ur.role_id = r.id
    WHERE ur.user_id = auth.uid()
    AND r.name IN ('super_admin', 'manager', 'staff')
  )
);

-- Function to auto-update updated_at
CREATE OR REPLACE FUNCTION update_event_images_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_event_images_updated_at_trigger
BEFORE UPDATE ON event_images
FOR EACH ROW
EXECUTE FUNCTION update_event_images_updated_at();

-- Add comment
COMMENT ON TABLE event_images IS 'Tracks uploaded images for events with metadata';