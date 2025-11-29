
// Manually mocking the imports since we can't easily run TS in this environment without fixing esbuild
// and we need to run the code that is inside the server action file but adapted for standalone node execution.

const { createClient } = require('@supabase/supabase-js');
const { format, parse, addMinutes, isWithinInterval, setHours, setMinutes } = require('date-fns');
const dotenv = require('dotenv');
const path = require('path');

// Load environment variables
dotenv.config({ path: path.resolve(__dirname, '../.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing Supabase URL or Key');
  process.exit(1);
}

// Restaurant capacity configuration
const RESTAURANT_CAPACITY = 50; 

function generateTimeSlots(
  openTime,
  closeTime,
  intervalMinutes = 30
) {
  const slots = [];
  const baseDate = new Date();
  
  // Parse times
  const [openHour, openMin] = openTime.split(':').map(Number);
  const [closeHour, closeMin] = closeTime.split(':').map(Number);
  
  let currentTime = setMinutes(setHours(baseDate, openHour), openMin);
  const endTime = setMinutes(setHours(baseDate, closeHour), closeMin);
  
  // Generate slots
  while (currentTime < endTime) {
    slots.push(format(currentTime, 'HH:mm'));
    currentTime = addMinutes(currentTime, intervalMinutes);
  }
  
  return slots;
}

async function checkAvailability(
  date,
  partySize,
  bookingType,
) {
  try {
    const supabase = createClient(supabaseUrl, supabaseKey);

    const bookingDate = new Date(date);
    const dayOfWeek = bookingDate.getDay();

    // Get business hours for the day
    const { data: businessHours } = await supabase
      .from('business_hours')
      .select('*')
      .eq('day_of_week', dayOfWeek)
      .single();
      
    // Check for special hours (holidays, etc.)
    const { data: specialHours } = await supabase
      .from('special_hours')
      .select('*')
      .eq('date', date)
      .single();
      
    const activeHours = specialHours || businessHours;
    
    console.log('[Availability] Checking for', date, 'Type:', bookingType);
    console.log('[Availability] Active Hours ID:', activeHours?.id);
    console.log('[Availability] Schedule Config:', JSON.stringify(activeHours?.schedule_config));

    // Check if closed
    if (!activeHours || activeHours.is_closed) {
      return { data: { available: false } };
    }

    // Determine effective kitchen hours from schedule_config if available
    let effectiveOpen = activeHours.kitchen_opens;
    let effectiveClose = activeHours.kitchen_closes;

    if (activeHours.schedule_config && Array.isArray(activeHours.schedule_config) && activeHours.schedule_config.length > 0) {
      const configs = activeHours.schedule_config.filter((c) => 
        !bookingType || c.booking_type === bookingType
      );

      if (configs.length > 0) {
        // Sort times to find range
        const starts = configs.map((c) => c.starts_at).sort();
        const ends = configs.map((c) => c.ends_at).sort();
        
        if (starts.length > 0) effectiveOpen = starts[0];
        if (ends.length > 0) effectiveClose = ends[ends.length - 1];
      }
    }
    
    console.log('[Availability] Effective Open:', effectiveOpen, 'Close:', effectiveClose);
    
    // Generate time slots from kitchen hours
    const allSlots = generateTimeSlots(
      effectiveOpen,
      effectiveClose,
      30 // 30-minute intervals
    );
    
    console.log('Generated Slots:', allSlots.slice(0, 5));

  } catch (error) {
    console.error('Availability check error:', error);
    return { error: 'Failed to check availability' };
  }
}

checkAvailability('2025-12-07', 2, 'sunday_lunch');
