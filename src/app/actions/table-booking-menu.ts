'use server';

import { createClient } from '@/lib/supabase/server';
import { checkUserPermission } from '@/app/actions/rbac';
import { logAuditEvent } from './audit';
import { z } from 'zod';
import { revalidatePath } from 'next/cache';

// Validation schemas
const MenuItemSchema = z.object({
  custom_item_name: z.string().min(1, 'Item name is required'),
  item_type: z.enum(['main', 'side', 'extra']),
  price: z.number().min(0),
  description: z.string().optional(),
  dietary_info: z.array(z.string()).optional(),
  allergens: z.array(z.string()).optional(),
  is_available: z.boolean().default(true),
  included_with_mains: z.boolean().default(false),
});

// Create booking menu selections (for Sunday lunch)
export async function addBookingMenuSelections(
  bookingId: string,
  selections: Array<{
    menu_item_id?: string;
    custom_item_name?: string;
    item_type: 'main' | 'side' | 'extra';
    quantity: number;
    special_requests?: string;
    price_at_booking: number;
    guest_name?: string;
  }>
) {
  try {
    const supabase = await createClient();
    
    // Check permissions
    const hasPermission = await checkUserPermission('table_bookings', 'edit');
    if (!hasPermission) {
      return { error: 'You do not have permission to manage bookings' };
    }
    
    // Verify booking exists and is Sunday lunch
    const { data: booking } = await supabase
      .from('table_bookings')
      .select('id, booking_type, status')
      .eq('id', bookingId)
      .single();
      
    if (!booking) {
      return { error: 'Booking not found' };
    }
    
    if (booking.booking_type !== 'sunday_lunch') {
      return { error: 'Menu selections only available for Sunday lunch bookings' };
    }
    
    // Delete existing selections
    await supabase
      .from('table_booking_items')
      .delete()
      .eq('booking_id', bookingId);
    
    // Insert new selections
    const { data, error } = await supabase
      .from('table_booking_items')
      .insert(selections.map(item => ({
        booking_id: bookingId,
        ...item,
      })))
      .select();
      
    if (error) {
      console.error('Menu selection error:', error);
      return { error: 'Failed to add menu selections' };
    }
    
    // Calculate total amount
    const totalAmount = selections.reduce((sum, item) => 
      sum + (item.price_at_booking * item.quantity), 0
    );
    
    // Update booking if status is pending_payment
    if (booking.status === 'pending_payment') {
      await supabase
        .from('table_bookings')
        .update({ 
          original_booking_data: { menu_total: totalAmount } 
        })
        .eq('id', bookingId);
    }
    
    // Log audit event
    await logAuditEvent({
      operation_type: 'update',
      resource_type: 'table_booking',
      resource_id: bookingId,
      operation_status: 'success',
      additional_info: { 
        action: 'menu_selections_updated',
        item_badge: selections.length,
        total_amount: totalAmount,
      }
    });
    
    revalidatePath(`/table-bookings/${bookingId}`);
    
    return { success: true, data, totalAmount };
  } catch (error) {
    console.error('Add menu selections error:', error);
    return { error: 'An unexpected error occurred' };
  }
}

// Get Sunday lunch menu for a specific date
export async function getSundayLunchMenu(date?: string) {
  try {
    const supabase = await createClient();
    
    // For now, return static menu items
    // In future, this could check menu_items table if available
    const menuItems = {
      main_courses: [
        {
          key: 'roast-chicken',
          custom_item_name: 'Roasted Chicken',
          item_type: 'main',
          price: 14.99,
          description: 'Succulent roasted chicken with all the trimmings',
          dietary_info: [],
          allergens: [],
          is_available: true,
        },
        {
          key: 'lamb-shank',
          custom_item_name: 'Slow-Cooked Lamb Shank',
          item_type: 'main',
          price: 15.49,
          description: 'Tender lamb shank slow-cooked to perfection',
          dietary_info: [],
          allergens: [],
          is_available: true,
        },
        {
          key: 'pork-belly',
          custom_item_name: 'Crispy Pork Belly',
          item_type: 'main',
          price: 15.99,
          description: 'Crispy pork belly with perfect crackling',
          dietary_info: [],
          allergens: [],
          is_available: true,
        },
        {
          key: 'wellington',
          custom_item_name: 'Beetroot & Butternut Squash Wellington',
          item_type: 'main',
          price: 15.49,
          description: 'Vegetarian wellington with seasonal vegetables',
          dietary_info: ['vegetarian'],
          allergens: ['gluten', 'nuts'],
          is_available: true,
        },
        {
          key: 'kids-chicken',
          custom_item_name: 'Kids Roasted Chicken',
          item_type: 'main',
          price: 9.99,
          description: 'Smaller portion of our delicious roasted chicken',
          dietary_info: [],
          allergens: [],
          is_available: true,
        },
      ],
      included_sides: [
        {
          key: 'yorkshire',
          custom_item_name: 'Yorkshire Pudding',
          item_type: 'side',
          price: 0,
          included_with_mains: true,
          dietary_info: ['vegetarian'],
          allergens: ['gluten', 'eggs', 'milk'],
        },
        {
          key: 'roast-potatoes',
          custom_item_name: 'Roast Potatoes',
          item_type: 'side',
          price: 0,
          included_with_mains: true,
          dietary_info: ['vegan', 'gluten-free'],
          allergens: [],
        },
        {
          key: 'seasonal-veg',
          custom_item_name: 'Seasonal Vegetables',
          item_type: 'side',
          price: 0,
          included_with_mains: true,
          dietary_info: ['vegan', 'gluten-free'],
          allergens: [],
        },
      ],
      extra_sides: [
        {
          key: 'cauliflower-cheese',
          custom_item_name: 'Cauliflower Cheese',
          item_type: 'extra',
          price: 3.99,
          description: 'Creamy cauliflower cheese',
          dietary_info: ['vegetarian'],
          allergens: ['milk'],
          is_available: true,
        },
        {
          key: 'extra-yorkshire',
          custom_item_name: 'Extra Yorkshire Pudding',
          item_type: 'extra',
          price: 2.50,
          dietary_info: ['vegetarian'],
          allergens: ['gluten', 'eggs', 'milk'],
          is_available: true,
        },
      ],
    };
    
    // Check if date is a Sunday
    if (date) {
      const dayOfWeek = new Date(date).getDay();
      if (dayOfWeek !== 0) {
        return { error: 'Sunday lunch menu only available on Sundays' };
      }
    }
    
    // Calculate cutoff time for ordering (1pm Saturday)
    const bookingDate = date ? new Date(date) : getNextSunday();
    const cutoffDate = new Date(bookingDate);
    cutoffDate.setDate(cutoffDate.getDate() - 1); // Saturday
    cutoffDate.setHours(13, 0, 0, 0); // 1pm
    
    return { 
      data: {
        menu_date: bookingDate.toISOString().split('T')[0],
        ...menuItems,
        cutoff_time: cutoffDate.toISOString(),
      }
    };
  } catch (error) {
    console.error('Get menu error:', error);
    return { error: 'An unexpected error occurred' };
  }
}

// Helper function to get next Sunday
function getNextSunday(): Date {
  const today = new Date();
  const dayOfWeek = today.getDay();
  const daysUntilSunday = dayOfWeek === 0 ? 7 : 7 - dayOfWeek;
  const nextSunday = new Date(today);
  nextSunday.setDate(today.getDate() + daysUntilSunday);
  return nextSunday;
}

// Calculate booking total from menu selections
export async function calculateBookingTotal(bookingId: string) {
  try {
    const supabase = await createClient();
    
    const { data: items, error } = await supabase
      .from('table_booking_items')
      .select('quantity, price_at_booking')
      .eq('booking_id', bookingId);
      
    if (error) {
      console.error('Calculate total error:', error);
      return { error: 'Failed to calculate total' };
    }
    
    const total = items.reduce((sum, item) => 
      sum + (item.price_at_booking * item.quantity), 0
    );
    
    return { data: { total } };
  } catch (error) {
    console.error('Calculate total error:', error);
    return { error: 'An unexpected error occurred' };
  }
}

// Update menu item prices (admin function)
export async function updateMenuItemPrice(
  itemName: string,
  newPrice: number
) {
  try {
    const supabase = await createClient();
    
    // Check permissions
    const hasPermission = await checkUserPermission('table_bookings', 'manage');
    if (!hasPermission) {
      return { error: 'You do not have permission to manage menu prices' };
    }
    
    // This is a placeholder - in production, you'd update the actual menu items table
    // For now, log the change
    await logAuditEvent({
      operation_type: 'update',
      resource_type: 'menu_price',
      resource_id: itemName,
      operation_status: 'success',
      additional_info: { 
        item_name: itemName,
        new_price: newPrice,
        note: 'Price update logged - manual update required',
      }
    });
    
    return { 
      success: true, 
      message: 'Price update logged. Update the getSundayLunchMenu function with new prices.' 
    };
  } catch (error) {
    console.error('Update price error:', error);
    return { error: 'An unexpected error occurred' };
  }
}