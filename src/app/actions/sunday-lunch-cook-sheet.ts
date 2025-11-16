'use server';

import { createClient } from '@/lib/supabase/server';
import { checkUserPermission } from '@/app/actions/rbac';
import { generatePDFFromHTML } from '@/lib/pdf-generator';
import { format } from 'date-fns';

type BookingItem = {
  custom_item_name?: string | null;
  item_type: string;
  quantity: number;
};

type BookingForSheet = {
  id: string;
  booking_reference: string;
  booking_time: string;
  party_size: number;
  status: string;
  customer?: {
    first_name?: string | null;
    last_name?: string | null;
  } | null;
  table_booking_items?: BookingItem[] | null;
  display_name?: string;
  main_counts?: Record<string, number>;
  has_mains?: boolean;
};

type BusinessHours = {
  kitchen_opens?: string | null;
  kitchen_closes?: string | null;
  is_closed?: boolean | null;
  is_kitchen_closed?: boolean | null;
  note?: string | null;
};

type MenuDish = {
  name: string;
  category_code?: string | null;
  available_from?: string | null;
  available_until?: string | null;
};

const SLOT_INTERVAL_MINUTES = 30;

function toDateOnly(date: Date) {
  return date.toISOString().split('T')[0];
}

function normaliseTime(time: string) {
  const parts = time.split(':');
  if (parts.length >= 2) {
    const [hours, minutes] = parts;
    return `${hours.padStart(2, '0')}:${minutes.padStart(2, '0')}`;
  }
  return time;
}

function generateSlots(openTime: string, closeTime: string) {
  const slots: string[] = [];
  const base = new Date();
  const [openHour, openMinute] = openTime.split(':').map(Number);
  const [closeHour, closeMinute] = closeTime.split(':').map(Number);

  const start = new Date(base);
  start.setHours(openHour, openMinute, 0, 0);
  const end = new Date(base);
  end.setHours(closeHour, closeMinute, 0, 0);

  let current = start;
  while (current < end) {
    slots.push(format(current, 'HH:mm'));
    current = new Date(current.getTime() + SLOT_INTERVAL_MINUTES * 60 * 1000);
  }

  return slots;
}

function sortTimes(a: string, b: string) {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
}

export async function generateSundayLunchCookSheet(targetDate: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { error: 'Authentication required' };
  }

  const canView = await checkUserPermission('table_bookings', 'view', user.id);
  if (!canView) {
    return { error: 'You do not have permission to view table bookings' };
  }

  if (!targetDate) {
    return { error: 'Please choose a Sunday date.' };
  }

  const parsedDate = new Date(targetDate);
  if (Number.isNaN(parsedDate.getTime())) {
    return { error: 'Invalid date provided.' };
  }
  if (parsedDate.getDay() !== 0) {
    return { error: 'Selected date must be a Sunday.' };
  }

  const dateIso = toDateOnly(parsedDate);

  // Load kitchen hours
  const [{ data: specialHours }, { data: businessHours }] = await Promise.all([
    supabase
      .from('special_hours')
      .select('kitchen_opens,kitchen_closes,is_closed,is_kitchen_closed,note')
      .eq('date', dateIso)
      .maybeSingle(),
    supabase
      .from('business_hours')
      .select('kitchen_opens,kitchen_closes,is_closed,is_kitchen_closed,note')
      .eq('day_of_week', 0)
      .maybeSingle(),
  ]);

  const activeHours: BusinessHours | null = specialHours || businessHours || null;
  const hasKitchenHours =
    activeHours &&
    !activeHours.is_closed &&
    !activeHours.is_kitchen_closed &&
    !!activeHours.kitchen_opens &&
    !!activeHours.kitchen_closes;

  // Fetch Sunday lunch mains for column headers
  const { data: menuItems } = await supabase
    .from('menu_dishes_with_costs')
    .select('name,category_code,available_from,available_until')
    .eq('menu_code', 'sunday_lunch')
    .eq('is_active', true)
    .order('category_code', { ascending: true })
    .order('sort_order', { ascending: true })
    .order('name', { ascending: true });

  const menuMains =
    menuItems
      ?.filter((item: MenuDish) => item.category_code === 'sunday_lunch_mains')
      .filter((item: MenuDish) => {
        const availableFrom = item.available_from ? new Date(item.available_from) : null;
        const availableUntil = item.available_until ? new Date(item.available_until) : null;
        return (
          (!availableFrom || availableFrom <= parsedDate) &&
          (!availableUntil || availableUntil >= parsedDate)
        );
      })
      .map((item: MenuDish) => item.name)
      .filter(Boolean) || [];

  // Fetch bookings and menu selections
  const { data: bookings, error: bookingsError } = await supabase
    .from('table_bookings')
    .select(
      `
        id,
        booking_reference,
        booking_time,
        party_size,
        status,
        customer:customers(first_name,last_name),
        table_booking_items(custom_item_name,item_type,quantity)
      `
    )
    .eq('booking_date', dateIso)
    .eq('booking_type', 'sunday_lunch')
    .in('status', ['pending_payment', 'confirmed', 'completed'])
    .order('booking_time', { ascending: true });

  if (bookingsError) {
    console.error('Failed to load Sunday lunch bookings:', bookingsError);
    return { error: 'Failed to load bookings for this date.' };
  }

  // Build lists of times and dishes
  const slotSet = new Set<string>(hasKitchenHours ? generateSlots(
    activeHours!.kitchen_opens as string,
    activeHours!.kitchen_closes as string
  ) : []);

  const bookingsWithItems: BookingForSheet[] = (bookings || []) as BookingForSheet[];
  const dishSet = new Set<string>(menuMains);
  const missingOrders: Array<{ reference: string; customer?: string; time: string }> = [];

  bookingsWithItems.forEach((booking) => {
    const slot = normaliseTime(booking.booking_time);
    if (!slotSet.has(slot)) {
      slotSet.add(slot);
    }
    const mains = booking.table_booking_items?.filter((item) => item.item_type === 'main') || [];
    const mainCounts: Record<string, number> = {};
    mains.forEach((item) => {
      const name = item.custom_item_name || 'Main';
      mainCounts[name] = (mainCounts[name] || 0) + Math.max(1, item.quantity || 1);
    });
    booking.main_counts = mainCounts;
    booking.has_mains = mains.length > 0;

    const customerName = booking.customer
      ? `${booking.customer.first_name || ''} ${booking.customer.last_name || ''}`.trim()
      : '';
    booking.display_name = customerName || `Booking ${booking.booking_reference}`;

    if (mains.length === 0) {
      missingOrders.push({
        reference: booking.booking_reference,
        time: slot,
        customer: customerName || undefined,
      });
    }
    mains.forEach((item) => {
      if (item.custom_item_name) {
        dishSet.add(item.custom_item_name);
      }
    });
  });

  const timeSlots = Array.from(slotSet).sort(sortTimes);
  const menuOrderedDishes = menuMains.filter((name) => dishSet.has(name));
  const nonMenuDishes = Array.from(dishSet).filter((name) => !menuOrderedDishes.includes(name)).sort();
  const dishNames = [...menuOrderedDishes, ...nonMenuDishes];
  const bookingsByTime: Record<string, BookingForSheet[]> = {};
  bookingsWithItems.forEach((booking) => {
    const slot = normaliseTime(booking.booking_time);
    if (!bookingsByTime[slot]) {
      bookingsByTime[slot] = [];
    }
    bookingsByTime[slot].push(booking);
  });

  // Build matrix counts
  const matrix: Record<string, Record<string, number>> = {};
  const slotTotals: Record<string, number> = {};
  const dishTotals: Record<string, number> = {};
  let totalMains = 0;

  bookingsWithItems.forEach((booking) => {
    const slot = normaliseTime(booking.booking_time);
    const mains =
      booking.table_booking_items?.filter((item) => item.item_type === 'main') || [];

    mains.forEach((item) => {
      const dishName = item.custom_item_name || 'Main';
      const quantity = Math.max(1, item.quantity || 1);

      if (!matrix[slot]) {
        matrix[slot] = {};
      }
      matrix[slot][dishName] = (matrix[slot][dishName] || 0) + quantity;
      slotTotals[slot] = (slotTotals[slot] || 0) + quantity;
      dishTotals[dishName] = (dishTotals[dishName] || 0) + quantity;
      totalMains += quantity;
    });
  });

  const totalBookings = bookingsWithItems.length;
  const overallPartySize = bookingsWithItems.reduce((sum, booking) => sum + (booking.party_size || 0), 0);

  const hoursNote = activeHours?.note || null;

  const html = `
    <html>
      <head>
        <style>
          @page { 
            size: A4 landscape;
            margin: 10mm;
          }
          * { box-sizing: border-box; }
          body { font-family: Arial, sans-serif; color: #0f172a; margin: 0; padding: 0; }
          .container { padding: 8px 12px; }
          .header { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 12px; }
          .title { font-size: 20px; font-weight: 700; margin: 0; }
          .subtitle { color: #4b5563; margin: 2px 0 0 0; font-size: 12px; }
          .meta { display: flex; gap: 16px; flex-wrap: wrap; margin-bottom: 10px; }
          .pill { background: #eef2ff; color: #3730a3; padding: 6px 10px; border-radius: 999px; font-weight: 600; font-size: 12px; }
          table { width: 100%; border-collapse: collapse; table-layout: fixed; font-size: 11px; }
          th, td { border: 1px solid #e5e7eb; padding: 6px 8px; text-align: center; }
          th { background: #0f172a; color: #fff; font-weight: 700; }
          td.time { text-align: left; font-weight: 700; background: #f9fafb; }
          td.total { font-weight: 700; background: #f3f4f6; }
          .note { font-size: 11px; color: #6b7280; margin-top: 8px; }
          .missing { margin-top: 10px; font-size: 11px; }
          .missing ul { margin: 4px 0 0 14px; padding: 0; }
          .section-title { font-size: 14px; font-weight: 700; margin: 16px 0 8px 0; }
          .booking-list { border: 1px solid #e5e7eb; border-radius: 8px; padding: 8px; background: #fafafa; }
          .booking-card { border: 1px solid #e5e7eb; border-radius: 6px; padding: 8px; margin-bottom: 8px; background: #fff; }
          .booking-card:last-child { margin-bottom: 0; }
          .booking-header { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 4px; }
          .booking-name { font-weight: 700; font-size: 12px; }
          .booking-ref { color: #6b7280; font-size: 11px; }
          .booking-mains { font-size: 11px; color: #111827; display: flex; flex-wrap: wrap; gap: 6px; }
          .pill-alt { background: #eef2ff; color: #1e3a8a; padding: 2px 6px; border-radius: 999px; font-weight: 600; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <div>
              <p class="title">Sunday Lunch Cook Sheet</p>
              <p class="subtitle">${format(parsedDate, 'EEEE d MMMM yyyy')}</p>
            </div>
            <div class="subtitle">Generated ${format(new Date(), 'HH:mm')}</div>
          </div>

          <div class="meta">
            <span class="pill">${totalBookings} booking${totalBookings === 1 ? '' : 's'}</span>
            <span class="pill">${overallPartySize} guest${overallPartySize === 1 ? '' : 's'}</span>
            <span class="pill">${totalMains} main${totalMains === 1 ? '' : 's'}</span>
            ${hoursNote ? `<span class="pill" style="background:#fff7ed;color:#c2410c;">${hoursNote}</span>` : ''}
          </div>

          <table>
            <thead>
              <tr>
                <th style="width: 90px; text-align:left;">Time</th>
                ${dishNames.map(name => `<th>${name}</th>`).join('')}
                <th style="width: 70px;">Total</th>
              </tr>
            </thead>
            <tbody>
              ${timeSlots.map(slot => `
                <tr>
                  <td class="time">${slot}</td>
                  ${dishNames.map(dish => `<td>${matrix[slot]?.[dish] || ''}</td>`).join('')}
                  <td class="total">${slotTotals[slot] || ''}</td>
                </tr>
              `).join('')}
              <tr>
                <td class="total">Totals</td>
                ${dishNames.map(dish => `<td class="total">${dishTotals[dish] || ''}</td>`).join('')}
                <td class="total">${totalMains || ''}</td>
              </tr>
            </tbody>
          </table>

          ${missingOrders.length > 0 ? `
            <div class="missing">
              <strong>Bookings without recorded mains:</strong>
              <ul>
                ${missingOrders.map(m => `<li>${m.time} - ${m.customer || 'Guest'} (${m.reference})</li>`).join('')}
              </ul>
            </div>
          ` : ''}

          ${timeSlots.length > 0 ? `
            <div class="section-title">Orders by booking and time</div>
            ${timeSlots.map(slot => `
              <div class="booking-list">
                <div class="booking-header">
                  <div class="booking-name">${slot}</div>
                  <div class="booking-ref">${(bookingsByTime[slot] || []).length} booking${(bookingsByTime[slot] || []).length === 1 ? '' : 's'}</div>
                </div>
                ${(bookingsByTime[slot] || []).map(booking => {
                  const mains = booking.main_counts || {};
                  const mainsList = Object.entries(mains).map(([dish, qty]) => `${qty} × ${dish}`).join(', ');
                  return `
                    <div class="booking-card">
                      <div class="booking-header">
                        <div class="booking-name">${booking.display_name || 'Guest'}</div>
                        <div class="booking-ref">Ref: ${booking.booking_reference}</div>
                      </div>
                      <div class="booking-mains">
                        ${mainsList ? mainsList : '<span class="pill-alt">No mains recorded</span>'}
                      </div>
                    </div>
                  `;
                }).join('')}
              </div>
            `).join('')}
          ` : ''}

          ${bookingsWithItems.length === 0 ? `
            <p class="note">No Sunday lunch bookings found for this date.</p>
          ` : ''}
        </div>
      </body>
    </html>
  `;

  const pdfBuffer = await generatePDFFromHTML(html, {
    format: 'A4',
    landscape: true,
    margin: {
      top: '10mm',
      right: '10mm',
      bottom: '12mm',
      left: '10mm',
    },
  });

  return {
    success: true,
    pdf: pdfBuffer.toString('base64'),
    filename: `sunday-lunch-${dateIso}.pdf`,
  };
}
