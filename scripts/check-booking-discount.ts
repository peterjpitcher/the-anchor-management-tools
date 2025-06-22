import { createClient } from '@/lib/supabase/server'

async function checkBookingDiscount() {
  const supabase = await createClient()
  
  const bookingId = '504f6dd0-3420-4ef4-aa9c-826b392f314c'
  
  // Check the booking
  const { data: booking, error } = await supabase
    .from('private_bookings')
    .select(`
      *,
      items:private_booking_items(*)
    `)
    .eq('id', bookingId)
    .single()
  
  if (error) {
    console.error('Error fetching booking:', error)
    return
  }
  
  console.log('\n=== BOOKING DETAILS ===')
  console.log('ID:', booking.id)
  console.log('Customer:', booking.customer_full_name)
  console.log('Status:', booking.status)
  console.log('\n=== DISCOUNT INFORMATION ===')
  console.log('Discount Type:', booking.discount_type || 'NULL')
  console.log('Discount Amount:', booking.discount_amount || 'NULL')
  console.log('Discount Reason:', booking.discount_reason || 'NULL')
  
  // Calculate subtotal from items
  const subtotal = booking.items?.reduce((sum: number, item: any) => 
    sum + (parseFloat(item.line_total) || 0), 0) || 0
  
  console.log('\n=== FINANCIAL SUMMARY ===')
  console.log('Subtotal:', `£${subtotal.toFixed(2)}`)
  console.log('Total Amount:', `£${booking.total_amount || '0.00'}`)
  
  console.log('\n=== ITEMS ===')
  booking.items?.forEach((item: any) => {
    console.log(`- ${item.description}: £${item.line_total}`)
  })
}

checkBookingDiscount().catch(console.error)