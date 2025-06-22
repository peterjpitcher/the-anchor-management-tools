import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { 
  PlusIcon, 
  CalendarIcon, 
  PencilIcon, 
  TrashIcon,
  CurrencyPoundIcon,
  ClockIcon,
  UserGroupIcon,
  PhoneIcon,
  EnvelopeIcon,
  CheckCircleIcon,
  ExclamationCircleIcon,
  BanknotesIcon,
  MapPinIcon,
  SparklesIcon,
  ChatBubbleLeftRightIcon
} from '@heroicons/react/24/outline'
import { CalendarDaysIcon } from '@heroicons/react/24/solid'
import { deletePrivateBooking } from '@/app/actions/privateBookingActions'
import DeleteBookingButton from '@/components/private-bookings/DeleteBookingButton'
import type { PrivateBookingWithDetails, BookingStatus, PrivateBookingItem } from '@/types/private-bookings'

async function handleDeleteBooking(formData: FormData) {
  'use server'
  
  const bookingId = formData.get('bookingId') as string
  const result = await deletePrivateBooking(bookingId)
  
  if (result.error) {
    console.error('Error deleting booking:', result.error)
  }
  
  // The revalidatePath in the action will refresh the page
}

// Status configuration
const statusConfig: Record<BookingStatus, { 
  label: string
  color: string
  bgColor: string
  borderColor: string
  icon: React.ComponentType<{ className?: string }>
}> = {
  draft: { 
    label: 'Draft', 
    color: 'text-gray-700', 
    bgColor: 'bg-gray-50', 
    borderColor: 'border-gray-200',
    icon: PencilIcon 
  },
  tentative: { 
    label: 'Tentative', 
    color: 'text-amber-700', 
    bgColor: 'bg-amber-50', 
    borderColor: 'border-amber-200',
    icon: ExclamationCircleIcon 
  },
  confirmed: { 
    label: 'Confirmed', 
    color: 'text-green-700', 
    bgColor: 'bg-green-50', 
    borderColor: 'border-green-200',
    icon: CheckCircleIcon 
  },
  completed: { 
    label: 'Completed', 
    color: 'text-blue-700', 
    bgColor: 'bg-blue-50', 
    borderColor: 'border-blue-200',
    icon: SparklesIcon 
  },
  cancelled: { 
    label: 'Cancelled', 
    color: 'text-red-700', 
    bgColor: 'bg-red-50', 
    borderColor: 'border-red-200',
    icon: TrashIcon 
  }
}

// Stats Card Component
function StatsCard({ 
  title, 
  value, 
  subtitle, 
  icon: Icon, 
  trend 
}: { 
  title: string
  value: string | number
  subtitle?: string
  icon: React.ComponentType<{ className?: string }>
  trend?: { value: number; isPositive: boolean }
}) {
  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6 hover:shadow-md transition-shadow">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-medium text-gray-600">{title}</p>
          <p className="text-3xl font-bold text-gray-900 mt-2">{value}</p>
          {subtitle && (
            <p className="text-sm text-gray-500 mt-1">{subtitle}</p>
          )}
        </div>
        <div className={`p-3 rounded-lg ${trend?.isPositive ? 'bg-green-50' : 'bg-gray-50'}`}>
          <Icon className={`h-6 w-6 ${trend?.isPositive ? 'text-green-600' : 'text-gray-600'}`} />
        </div>
      </div>
      {trend && (
        <div className="mt-4 flex items-center">
          <span className={`text-sm font-medium ${trend.isPositive ? 'text-green-600' : 'text-red-600'}`}>
            {trend.isPositive ? '+' : ''}{trend.value}%
          </span>
          <span className="text-sm text-gray-500 ml-2">from last month</span>
        </div>
      )}
    </div>
  )
}

// Booking Card Component
function BookingCard({ 
  booking, 
  hasEditPermission: _hasEditPermission, 
  hasDeletePermission 
}: { 
  booking: PrivateBookingWithDetails
  hasEditPermission: boolean
  hasDeletePermission: boolean
}) {
  const status = statusConfig[booking.status]
  const StatusIcon = status.icon
  
  const formatDate = (date: string) => {
    return new Date(date).toLocaleDateString('en-GB', {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      year: 'numeric'
    })
  }

  const formatTime = (time: string) => {
    return time.substring(0, 5)
  }

  const getDaysUntilEvent = () => {
    const days = Math.ceil((new Date(booking.event_date).getTime() - new Date().getTime()) / (1000 * 60 * 60 * 24))
    if (days < 0) return { text: 'Past event', color: 'text-gray-500' }
    if (days === 0) return { text: 'Today!', color: 'text-red-600 font-bold' }
    if (days === 1) return { text: 'Tomorrow', color: 'text-orange-600 font-semibold' }
    if (days <= 7) return { text: `In ${days} days`, color: 'text-orange-600' }
    if (days <= 30) return { text: `In ${days} days`, color: 'text-yellow-600' }
    return { text: `In ${days} days`, color: 'text-gray-600' }
  }

  const daysInfo = getDaysUntilEvent()

  return (
    <div className={`bg-white rounded-xl shadow-sm border-2 ${status.borderColor} hover:shadow-lg transition-all duration-200 overflow-hidden group`}>
      {/* Status Header */}
      <div className={`${status.bgColor} px-6 py-3 border-b ${status.borderColor}`}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <StatusIcon className={`h-5 w-5 ${status.color}`} />
            <span className={`text-sm font-semibold ${status.color}`}>{status.label}</span>
          </div>
          <span className={`text-sm ${daysInfo.color}`}>{daysInfo.text}</span>
        </div>
      </div>

      {/* Main Content */}
      <div className="p-6">
        <div className="flex items-start justify-between mb-4">
          <Link href={`/private-bookings/${booking.id}`} className="flex-1">
            <h3 className="text-xl font-bold text-gray-900 group-hover:text-blue-600 transition-colors cursor-pointer">
              {booking.customer_full_name || booking.customer_name}
            </h3>
            {booking.event_type && (
              <p className="text-sm text-gray-600 mt-1 flex items-center gap-1">
                <SparklesIcon className="h-4 w-4" />
                {booking.event_type}
              </p>
            )}
          </Link>
          {hasDeletePermission && (
            <div className="opacity-0 group-hover:opacity-100 transition-opacity">
              <DeleteBookingButton 
                bookingId={booking.id}
                bookingName={booking.customer_full_name || booking.customer_name}
                deleteAction={handleDeleteBooking}
                eventDate={booking.event_date}
                status={booking.status}
              />
            </div>
          )}
        </div>

        {/* Event Details Grid */}
        <div className="grid grid-cols-2 gap-4 mb-4">
          <div className="flex items-center gap-2 text-sm">
            <CalendarDaysIcon className="h-4 w-4 text-gray-400" />
            <span className="text-gray-900 font-medium">{formatDate(booking.event_date)}</span>
          </div>
          <div className="flex items-center gap-2 text-sm">
            <ClockIcon className="h-4 w-4 text-gray-400" />
            <span className="text-gray-900">
              {formatTime(booking.start_time)}
              {booking.end_time && ` - ${formatTime(booking.end_time)}`}
            </span>
          </div>
          {booking.guest_count && (
            <div className="flex items-center gap-2 text-sm">
              <UserGroupIcon className="h-4 w-4 text-gray-400" />
              <span className="text-gray-900">{booking.guest_count} guests</span>
            </div>
          )}
          <div className="flex items-center gap-2 text-sm">
            <CurrencyPoundIcon className="h-4 w-4 text-gray-400" />
            <span className="text-gray-900 font-medium">£{(booking.calculated_total || 0).toFixed(2)}</span>
          </div>
        </div>

        {/* Contact Info */}
        {(booking.contact_phone || booking.contact_email) && (
          <div className="flex flex-wrap gap-3 pt-3 border-t border-gray-100">
            {booking.contact_phone && (
              <a 
                href={`tel:${booking.contact_phone}`}
                className="flex items-center gap-1 text-sm text-gray-600 hover:text-blue-600 transition-colors"
              >
                <PhoneIcon className="h-4 w-4" />
                {booking.contact_phone}
              </a>
            )}
            {booking.contact_email && (
              <a 
                href={`mailto:${booking.contact_email}`}
                className="flex items-center gap-1 text-sm text-gray-600 hover:text-blue-600 transition-colors"
              >
                <EnvelopeIcon className="h-4 w-4" />
                {booking.contact_email}
              </a>
            )}
          </div>
        )}

        {/* Deposit Status */}
        {booking.status !== 'draft' && (
          <div className="mt-3 pt-3 border-t border-gray-100">
            <div className="flex items-center justify-between">
              <span className="text-sm text-gray-600">Deposit Status</span>
              <span className={`text-sm font-medium ${
                booking.deposit_status === 'Paid' 
                  ? 'text-green-600' 
                  : booking.deposit_status === 'Required' 
                    ? 'text-amber-600' 
                    : 'text-gray-600'
              }`}>
                {booking.deposit_status === 'Paid' && <CheckCircleIcon className="h-4 w-4 inline mr-1" />}
                {booking.deposit_status}
              </span>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

export default async function PrivateBookingsPage() {
  const supabase = await createClient()
  
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    redirect('/login')
  }

  // Check permissions
  const { data: hasViewPermission } = await supabase.rpc('user_has_permission', {
    p_user_id: user.id,
    p_module_name: 'private_bookings',
    p_action: 'view'
  })

  if (!hasViewPermission) {
    redirect('/unauthorized')
  }

  const { data: hasCreatePermission } = await supabase.rpc('user_has_permission', {
    p_user_id: user.id,
    p_module_name: 'private_bookings',
    p_action: 'create'
  })

  const { data: hasEditPermission } = await supabase.rpc('user_has_permission', {
    p_user_id: user.id,
    p_module_name: 'private_bookings',
    p_action: 'edit'
  })

  const { data: hasDeletePermission } = await supabase.rpc('user_has_permission', {
    p_user_id: user.id,
    p_module_name: 'private_bookings',
    p_action: 'delete'
  })

  // Fetch bookings with customer details
  const { data: bookings, error } = await supabase
    .from('private_bookings')
    .select(`
      *,
      customer:customers(id, first_name, last_name, mobile_number),
      items:private_booking_items(line_total)
    `)
    .order('event_date', { ascending: true })

  if (error) {
    console.error('Error fetching private bookings:', error)
  }

  // Calculate totals and enrich data
  const enrichedBookings: PrivateBookingWithDetails[] = bookings?.map(booking => ({
    ...booking,
    calculated_total: booking.items?.reduce((sum: number, item: PrivateBookingItem) => sum + (item.line_total || 0), 0) || 0,
    deposit_status: booking.deposit_paid_date 
      ? 'Paid' 
      : booking.status === 'confirmed' 
        ? 'Required' 
        : 'Not Required',
    days_until_event: Math.ceil((new Date(booking.event_date).getTime() - new Date().getTime()) / (1000 * 60 * 60 * 24))
  })) || []

  // Calculate statistics
  const upcomingBookings = enrichedBookings.filter(b => (b.days_until_event ?? 0) >= 0)
  const thisMonthBookings = enrichedBookings.filter(b => {
    const bookingMonth = new Date(b.event_date).getMonth()
    const currentMonth = new Date().getMonth()
    const bookingYear = new Date(b.event_date).getFullYear()
    const currentYear = new Date().getFullYear()
    return bookingMonth === currentMonth && bookingYear === currentYear
  })
  
  const totalRevenue = enrichedBookings
    .filter(b => b.status === 'confirmed' || b.status === 'completed')
    .reduce((sum, b) => sum + (b.calculated_total || 0), 0)

  const pendingDeposits = enrichedBookings.filter(
    b => b.status === 'confirmed' && b.deposit_status === 'Required'
  ).length

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header Section */}
      <div className="bg-white border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
            <div>
              <h1 className="text-3xl font-bold text-gray-900">Private Bookings</h1>
              <p className="text-gray-600 mt-1">Manage venue hire and private events</p>
            </div>
            <div className="flex gap-3">
              <Link
                href="/private-bookings/sms-queue"
                className="flex items-center gap-2 px-4 py-2 bg-purple-100 text-purple-700 rounded-lg hover:bg-purple-200 transition-colors"
              >
                <ChatBubbleLeftRightIcon className="h-5 w-5" />
                SMS Queue
              </Link>
              <Link
                href="/private-bookings/calendar"
                className="flex items-center gap-2 px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors"
              >
                <CalendarIcon className="h-5 w-5" />
                Calendar View
              </Link>
              {hasCreatePermission && (
                <Link
                  href="/private-bookings/new"
                  className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors shadow-sm"
                >
                  <PlusIcon className="h-5 w-5" />
                  New Booking
                </Link>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Statistics Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
          <StatsCard
            title="Upcoming Events"
            value={upcomingBookings.length}
            subtitle="Active bookings"
            icon={CalendarDaysIcon}
            trend={{ value: 12, isPositive: true }}
          />
          <StatsCard
            title="This Month"
            value={thisMonthBookings.length}
            subtitle={`${new Date().toLocaleDateString('en-GB', { month: 'long' })} bookings`}
            icon={CalendarIcon}
          />
          <StatsCard
            title="Total Revenue"
            value={`£${totalRevenue.toFixed(0)}`}
            subtitle="Confirmed bookings"
            icon={CurrencyPoundIcon}
            trend={{ value: 8, isPositive: true }}
          />
          <StatsCard
            title="Pending Deposits"
            value={pendingDeposits}
            subtitle="Awaiting payment"
            icon={BanknotesIcon}
          />
        </div>

        {/* Bookings Grid */}
        {bookings?.length === 0 ? (
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-12 text-center">
            <div className="mx-auto w-24 h-24 bg-gray-100 rounded-full flex items-center justify-center mb-4">
              <CalendarDaysIcon className="h-12 w-12 text-gray-400" />
            </div>
            <h3 className="text-lg font-semibold text-gray-900 mb-2">No bookings yet</h3>
            <p className="text-gray-600 mb-6 max-w-md mx-auto">
              Start managing your private events and venue hire bookings. Create your first booking to get started.
            </p>
            {hasCreatePermission && (
              <Link
                href="/private-bookings/new"
                className="inline-flex items-center gap-2 px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors shadow-sm"
              >
                <PlusIcon className="h-5 w-5" />
                Create First Booking
              </Link>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-6">
            {enrichedBookings.map((booking) => (
              <BookingCard
                key={booking.id}
                booking={booking}
                hasEditPermission={hasEditPermission || false}
                hasDeletePermission={hasDeletePermission || false}
              />
            ))}
          </div>
        )}

        {/* Quick Links Section */}
        <div className="mt-12">
          <h2 className="text-xl font-semibold text-gray-900 mb-6">Quick Links</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Link
              href="/private-bookings/settings/spaces"
              className="bg-white p-6 rounded-xl shadow-sm border border-gray-200 hover:shadow-md transition-all group"
            >
              <div className="flex items-start justify-between">
                <div>
                  <h3 className="font-semibold text-gray-900 group-hover:text-blue-600 transition-colors">
                    Manage Spaces
                  </h3>
                  <p className="text-sm text-gray-600 mt-1">Configure venue spaces and pricing</p>
                </div>
                <MapPinIcon className="h-8 w-8 text-gray-400 group-hover:text-blue-500 transition-colors" />
              </div>
            </Link>
            
            <Link
              href="/private-bookings/settings/catering"
              className="bg-white p-6 rounded-xl shadow-sm border border-gray-200 hover:shadow-md transition-all group"
            >
              <div className="flex items-start justify-between">
                <div>
                  <h3 className="font-semibold text-gray-900 group-hover:text-blue-600 transition-colors">
                    Catering Packages
                  </h3>
                  <p className="text-sm text-gray-600 mt-1">Manage food and drink options</p>
                </div>
                <SparklesIcon className="h-8 w-8 text-gray-400 group-hover:text-blue-500 transition-colors" />
              </div>
            </Link>
            
            <Link
              href="/private-bookings/settings/vendors"
              className="bg-white p-6 rounded-xl shadow-sm border border-gray-200 hover:shadow-md transition-all group"
            >
              <div className="flex items-start justify-between">
                <div>
                  <h3 className="font-semibold text-gray-900 group-hover:text-blue-600 transition-colors">
                    Vendor Database
                  </h3>
                  <p className="text-sm text-gray-600 mt-1">Maintain preferred vendor list</p>
                </div>
                <UserGroupIcon className="h-8 w-8 text-gray-400 group-hover:text-blue-500 transition-colors" />
              </div>
            </Link>
          </div>
        </div>

        {/* Contact Footer */}
        <div className="mt-12 bg-gradient-to-r from-blue-600 to-indigo-600 rounded-xl p-8 text-white text-center">
          <h3 className="text-2xl font-bold mb-2">Need Help with Bookings?</h3>
          <p className="text-blue-100 mb-4">Contact The Anchor team for assistance</p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center items-center">
            <a 
              href="tel:01753682707" 
              className="flex items-center gap-2 px-6 py-3 bg-white text-blue-600 rounded-lg hover:bg-blue-50 transition-colors font-medium"
            >
              <PhoneIcon className="h-5 w-5" />
              01753 682 707
            </a>
            <a 
              href="mailto:manager@the-anchor.pub" 
              className="flex items-center gap-2 px-6 py-3 bg-blue-700 text-white rounded-lg hover:bg-blue-800 transition-colors font-medium"
            >
              <EnvelopeIcon className="h-5 w-5" />
              manager@the-anchor.pub
            </a>
          </div>
        </div>
      </div>
    </div>
  )
}