import { NextRequest } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { createApiResponse, createErrorResponse } from '@/lib/api/auth';

export async function GET(request: NextRequest) {
  // This endpoint can be public for SEO purposes
  const supabase = createAdminClient();
  
  const { data: amenities, error } = await supabase
    .from('business_amenities')
    .select('*')
    .order('type', { ascending: true });

  if (error) {
    return createErrorResponse('Failed to fetch amenities', 'DATABASE_ERROR', 500);
  }

  const formattedAmenities = amenities?.map(amenity => ({
    type: amenity.type,
    available: amenity.available,
    details: amenity.details,
    capacity: amenity.capacity,
    ...amenity.additional_info,
  })) || [];

  return createApiResponse({
    amenities: formattedAmenities,
    lastUpdated: new Date().toISOString(),
  });
}

export async function OPTIONS(request: NextRequest) {
  return createApiResponse({}, 200);
}