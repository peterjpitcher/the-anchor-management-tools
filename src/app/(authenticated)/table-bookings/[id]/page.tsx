'use client';

import { useState, useEffect, use } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useSupabase } from '@/components/providers/SupabaseProvider';
import { usePermissions } from '@/contexts/PermissionContext';
import { format } from 'date-fns';
import { 
  ArrowLeftIcon,
  PencilIcon,
  XMarkIcon,
  CheckCircleIcon,
  ExclamationCircleIcon,
  PhoneIcon,
  EnvelopeIcon,
  CalendarIcon,
  ClockIcon,
  UserGroupIcon,
  CurrencyPoundIcon,
  DocumentTextIcon,
  ExclamationTriangleIcon
} from '@heroicons/react/24/outline';
import { TableBooking, TableBookingItem, TableBookingPayment } from '@/types/table-bookings';
import { cancelTableBooking, markBookingNoShow, markBookingCompleted } from '@/app/actions/table-bookings';
import { processBookingRefund, getRefundEligibility } from '@/app/actions/table-booking-refunds';
import { queueBookingReminderSMS } from '@/app/actions/table-booking-sms';
import { PageHeader } from '@/components/ui-v2/layout/PageHeader';
import { PageWrapper, PageContent } from '@/components/ui-v2/layout/PageWrapper';
import { Card } from '@/components/ui-v2/layout/Card';
import { Section } from '@/components/ui-v2/layout/Section';
import { Button } from '@/components/ui-v2/forms/Button';
import { LinkButton } from '@/components/ui-v2/navigation/LinkButton';
import { Form } from '@/components/ui-v2/forms/Form';
import { FormGroup } from '@/components/ui-v2/forms/FormGroup';
import { Textarea } from '@/components/ui-v2/forms/Textarea';
import { Alert } from '@/components/ui-v2/feedback/Alert';
import { Badge } from '@/components/ui-v2/display/Badge';
import { Spinner } from '@/components/ui-v2/feedback/Spinner';
import { Modal } from '@/components/ui-v2/overlay/Modal';
import { toast } from '@/components/ui-v2/feedback/Toast';
export default function BookingDetailsPage(props: { params: Promise<{ id: string }> }) {
  const params = use(props.params);
  const router = useRouter();
  const searchParams = useSearchParams();
  const supabase = useSupabase();
  const { hasPermission } = usePermissions();
  const [booking, setBooking] = useState<TableBooking | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [processing, setProcessing] = useState(false);
  const [showCancelModal, setShowCancelModal] = useState(false);
  const [cancelReason, setCancelReason] = useState('');
  const [refundEligibility, setRefundEligibility] = useState<any>(null);

  const canView = hasPermission('table_bookings', 'view');
  const canEdit = hasPermission('table_bookings', 'edit');
  const canManage = hasPermission('table_bookings', 'manage');

  useEffect(() => {
    if (canView) {
      loadBooking();
    }
  }, [params.id, canView]);

  // Handle error from payment redirect
  useEffect(() => {
    const errorParam = searchParams.get('error');
    const errorMessage = searchParams.get('message');
    
    if (errorParam === 'payment_failed' && errorMessage) {
      toast.error(decodeURIComponent(errorMessage));
      
      // Clean up URL
      const newUrl = new URL(window.location.href);
      newUrl.searchParams.delete('error');
      newUrl.searchParams.delete('message');
      window.history.replaceState({}, '', newUrl.toString());
    }
  }, [searchParams]);

  async function loadBooking() {
    try {
      setLoading(true);
      setError(null);

      const { data, error } = await supabase
        .from('table_bookings')
        .select(`
          *,
          customer:customers(*),
          table_booking_items(*),
          table_booking_payments(*),
          table_booking_modifications(*)
        `)
        .eq('id', params.id)
        .single();

      if (error) throw error;
      
      setBooking(data);

      // Check refund eligibility if there's a payment
      if (data.table_booking_payments?.some((p: TableBookingPayment) => p.status === 'completed')) {
        const eligibility = await getRefundEligibility(data.id);
        if (eligibility.data) {
          setRefundEligibility(eligibility.data);
        }
      }
    } catch (err: any) {
      console.error('Error loading booking:', err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleCancel() {
    if (!booking || !cancelReason) return;

    try {
      setProcessing(true);
      const result = await cancelTableBooking(booking.id, cancelReason);
      
      if (result.error) {
        setError(result.error);
      } else {
        setShowCancelModal(false);
        await loadBooking();
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setProcessing(false);
    }
  }

  async function handleNoShow() {
    if (!booking) return;

    if (!confirm('Mark this booking as a no-show?')) return;

    try {
      setProcessing(true);
      const result = await markBookingNoShow(booking.id);
      
      if (result.error) {
        setError(result.error);
      } else {
        await loadBooking();
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setProcessing(false);
    }
  }

  async function handleComplete() {
    if (!booking) return;

    try {
      setProcessing(true);
      const result = await markBookingCompleted(booking.id);
      
      if (result.error) {
        setError(result.error);
      } else {
        await loadBooking();
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setProcessing(false);
    }
  }

  async function handleRefund() {
    if (!booking || !refundEligibility) return;

    if (!confirm(`Process refund of £${refundEligibility.refund_amount.toFixed(2)}?`)) return;

    try {
      setProcessing(true);
      const result = await processBookingRefund(booking.id);
      
      if (result.error) {
        setError(result.error);
      } else {
        await loadBooking();
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setProcessing(false);
    }
  }

  async function handleSendReminder() {
    if (!booking) return;

    try {
      setProcessing(true);
      const result = await queueBookingReminderSMS(booking.id);
      
      if (result.error) {
        setError(result.error);
      } else {
        toast.success('Reminder SMS queued successfully');
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setProcessing(false);
    }
  }

  if (!canView) {
    return (
      <PageWrapper>
        <PageHeader 
          title="Access Denied"
          backButton={{
            label: "Back to Table Bookings",
            onBack: () => router.push('/table-bookings')
          }}
        />
        <PageContent>
          <Alert variant="error" description="You do not have permission to view booking details." />
        </PageContent>
      </PageWrapper>
    );
  }

  if (loading) {
    return (
      <PageWrapper>
        <PageHeader title="Loading..." />
        <PageContent>
          <div className="flex items-center justify-center h-64">
            <Spinner size="lg" />
          </div>
        </PageContent>
      </PageWrapper>
    );
  }

  if (error || !booking) {
    return (
      <PageWrapper>
        <PageHeader title="Error" />
        <PageContent>
          <Alert variant="error" description={error || 'Booking not found'} />
        </PageContent>
      </PageWrapper>
    );
  }

  const payment = booking.table_booking_payments?.find(p => p.status === 'completed');
  const bookingDateTime = new Date(`${booking.booking_date}T${booking.booking_time}`);
  const isPast = bookingDateTime < new Date();

  return (
    <PageWrapper>
      <PageHeader
        title={`Booking ${booking.booking_reference}`}
        subtitle={`Created ${format(new Date(booking.created_at), 'dd/MM/yyyy HH:mm')} • Source: ${booking.source}`}
        breadcrumbs={[
          { label: 'Table Bookings', href: '/table-bookings' },
          { label: booking.booking_reference, href: '' }
        ]}
      />
      <PageContent>
        <Card>
        {/* Header */}
        <div className="p-6 border-b">
          <div className="flex justify-between items-start">
            <div className="flex items-center gap-2">
              {booking.status === 'confirmed' && (
                <Badge variant="success">
                  <CheckCircleIcon className="h-4 w-4" />
                  Confirmed
                </Badge>
              )}
              {booking.status === 'pending_payment' && (
                <Badge variant="warning">
                  <ExclamationCircleIcon className="h-4 w-4" />
                  Awaiting Payment
                </Badge>
              )}
              {booking.status === 'cancelled' && (
                <Badge variant="error">
                  <XMarkIcon className="h-4 w-4" />
                  Cancelled
                </Badge>
              )}
              {booking.status === 'no_show' && (
                <Badge variant="secondary">
                  No Show
                </Badge>
              )}
              {booking.status === 'completed' && (
                <Badge variant="info">
                  Completed
                </Badge>
              )}
            </div>
          </div>
        </div>

        {/* Main Content */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 p-6">
          {/* Left Column - Booking Details */}
          <div className="lg:col-span-2 space-y-6">
            {/* Date & Time */}
            <Card variant="bordered">
              <h2 className="font-semibold mb-3">Booking Details</h2>
              <div className="grid grid-cols-2 gap-4">
                <div className="flex items-center gap-3">
                  <CalendarIcon className="h-5 w-5 text-gray-400" />
                  <div>
                    <p className="text-sm text-gray-600">Date</p>
                    <p className="font-medium">{format(new Date(booking.booking_date), 'EEEE, d MMMM yyyy')}</p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <ClockIcon className="h-5 w-5 text-gray-400" />
                  <div>
                    <p className="text-sm text-gray-600">Time</p>
                    <p className="font-medium">{booking.booking_time} ({booking.duration_minutes} mins)</p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <UserGroupIcon className="h-5 w-5 text-gray-400" />
                  <div>
                    <p className="text-sm text-gray-600">Party Size</p>
                    <p className="font-medium">{booking.party_size} people</p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <DocumentTextIcon className="h-5 w-5 text-gray-400" />
                  <div>
                    <p className="text-sm text-gray-600">Type</p>
                    <p className="font-medium">{booking.booking_type === 'sunday_lunch' ? 'Sunday Lunch' : 'Regular Dining'}</p>
                  </div>
                </div>
              </div>
            </Card>

            {/* Special Requirements */}
            {(booking.special_requirements || booking.dietary_requirements?.length || booking.allergies?.length || booking.celebration_type) && (
              <Card variant="bordered">
                <h2 className="font-semibold mb-3">Special Requirements</h2>
                <div className="space-y-2">
                  {booking.special_requirements && (
                    <div>
                      <p className="text-sm text-gray-600">Requirements</p>
                      <p>{booking.special_requirements}</p>
                    </div>
                  )}
                  {booking.dietary_requirements && booking.dietary_requirements.length > 0 && (
                    <div>
                      <p className="text-sm text-gray-600">Dietary</p>
                      <p>{booking.dietary_requirements.join(', ')}</p>
                    </div>
                  )}
                  {booking.allergies && booking.allergies.length > 0 && (
                    <div className="flex items-start gap-2">
                      <ExclamationTriangleIcon className="h-5 w-5 text-red-500 mt-0.5" />
                      <div>
                        <p className="text-sm text-gray-600">Allergies</p>
                        <p className="text-red-600 font-medium">{booking.allergies.join(', ')}</p>
                      </div>
                    </div>
                  )}
                  {booking.celebration_type && (
                    <div>
                      <p className="text-sm text-gray-600">Celebration</p>
                      <p className="capitalize">{booking.celebration_type}</p>
                    </div>
                  )}
                </div>
              </Card>
            )}

            {/* Sunday Lunch Order */}
            {booking.booking_type === 'sunday_lunch' && booking.table_booking_items && booking.table_booking_items.length > 0 && (
              <Card variant="bordered">
                <h2 className="font-semibold mb-3">Sunday Lunch Order</h2>
                <div className="space-y-2">
                  {booking.table_booking_items.map((item: TableBookingItem) => (
                    <div key={item.id} className="flex justify-between">
                      <div>
                        <p className="font-medium">
                          {item.quantity}x {item.custom_item_name || 'Menu Item'}
                        </p>
                        {item.special_requests && (
                          <p className="text-sm text-gray-600">{item.special_requests}</p>
                        )}
                        {item.guest_name && (
                          <p className="text-sm text-gray-600">For: {item.guest_name}</p>
                        )}
                      </div>
                      <p className="font-medium">£{(item.price_at_booking * item.quantity).toFixed(2)}</p>
                    </div>
                  ))}
                  <div className="border-t pt-2 mt-2">
                    <div className="flex justify-between font-semibold">
                      <p>Total</p>
                      <p>£{booking.table_booking_items.reduce((sum, item) => sum + (item.price_at_booking * item.quantity), 0).toFixed(2)}</p>
                    </div>
                  </div>
                </div>
              </Card>
            )}

            {/* Payment Information */}
            {payment && (
              <Card variant="bordered">
                <h2 className="font-semibold mb-3">Payment Information</h2>
                <div className="space-y-2">
                  <div className="flex justify-between">
                    <span className="text-gray-600">Status</span>
                    <span className="font-medium capitalize">{payment.status}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-600">Amount</span>
                    <span className="font-medium">£{payment.amount.toFixed(2)}</span>
                  </div>
                  {payment.transaction_id && (
                    <div className="flex justify-between">
                      <span className="text-gray-600">Transaction ID</span>
                      <span className="font-mono text-sm">{payment.transaction_id}</span>
                    </div>
                  )}
                  {payment.paid_at && (
                    <div className="flex justify-between">
                      <span className="text-gray-600">Paid</span>
                      <span>{format(new Date(payment.paid_at), 'dd/MM/yyyy HH:mm')}</span>
                    </div>
                  )}
                  {payment.refund_amount && (
                    <div className="flex justify-between text-red-600">
                      <span>Refund</span>
                      <span className="font-medium">£{payment.refund_amount.toFixed(2)}</span>
                    </div>
                  )}
                </div>
              </Card>
            )}
          </div>

          {/* Right Column - Customer & Actions */}
          <div className="space-y-6">
            {/* Customer Information */}
            <Card variant="bordered">
              <h2 className="font-semibold mb-3">Customer</h2>
              <div className="space-y-3">
                <div>
                  <p className="font-medium">
                    {booking.customer?.first_name} {booking.customer?.last_name}
                  </p>
                </div>
                <div className="flex items-center gap-2 text-sm">
                  <PhoneIcon className="h-4 w-4 text-gray-400" />
                  <a href={`tel:${booking.customer?.mobile_number}`} className="text-blue-600 hover:underline">
                    {booking.customer?.mobile_number}
                  </a>
                </div>
                {booking.customer?.email && (
                  <div className="flex items-center gap-2 text-sm">
                    <EnvelopeIcon className="h-4 w-4 text-gray-400" />
                    <a href={`mailto:${booking.customer.email}`} className="text-blue-600 hover:underline">
                      {booking.customer.email}
                    </a>
                  </div>
                )}
                <div className="pt-2 text-sm text-gray-600">
                  <p>SMS Opt-in: {booking.customer?.sms_opt_in ? 'Yes' : 'No'}</p>
                  <p>Total Bookings: {booking.customer?.table_booking_count || 0}</p>
                  {booking.customer?.no_show_count ? (
                    <p className="text-red-600">No-shows: {booking.customer.no_show_count}</p>
                  ) : null}
                </div>
              </div>
            </Card>

            {/* Actions */}
            <Card variant="bordered">
              <h2 className="font-semibold mb-3">Actions</h2>
              <div className="space-y-2">
                {canEdit && booking.status === 'confirmed' && !isPast && (
                  <>
                    <LinkButton href={`/table-bookings/${booking.id}/edit`}
                      leftIcon={<PencilIcon className="h-4 w-4" />}
                      fullWidth
                    >
                      Edit Booking
                    </LinkButton>
                    <Button
                      onClick={handleSendReminder}
                      loading={processing}
                      variant="secondary"
                      fullWidth
                    >
                      Send Reminder SMS
                    </Button>
                    <Button
                      onClick={() => setShowCancelModal(true)}
                      loading={processing}
                      variant="danger"
                      leftIcon={<XMarkIcon className="h-4 w-4" />}
                      fullWidth
                    >
                      Cancel Booking
                    </Button>
                  </>
                )}
                
                {canEdit && booking.status === 'confirmed' && isPast && (
                  <>
                    <Button
                      onClick={handleComplete}
                      loading={processing}
                      variant="success"
                      fullWidth
                    >
                      Mark as Completed
                    </Button>
                    <Button
                      onClick={handleNoShow}
                      loading={processing}
                      variant="secondary"
                      fullWidth
                    >
                      Mark as No-Show
                    </Button>
                  </>
                )}

                {canManage && payment && refundEligibility && refundEligibility.refund_amount > 0 && (
                  <Button
                    onClick={handleRefund}
                    loading={processing}
                    variant="secondary"
                    fullWidth
                  >
                    Process Refund (£{refundEligibility.refund_amount.toFixed(2)})
                  </Button>
                )}

                {booking.status === 'pending_payment' && (
                  <div className="text-center">
                    <p className="text-sm text-gray-600 mb-2">Payment required to confirm</p>
                    <Button
                      variant="primary"
                      onClick={() => {
                        setProcessing(true);
                        window.location.href = `/api/table-bookings/payment/create?booking_id=${booking.id}`;
                      }}
                      loading={processing}
                      disabled={processing}
                    >
                      Process Payment
                    </Button>
                  </div>
                )}
              </div>
            </Card>

            {/* Refund Eligibility */}
            {refundEligibility && (
              <Alert variant="warning"
                title="Refund Policy"
                description={refundEligibility.refund_reason}
              />
            )}
          </div>
        </div>
      </Card>

      {/* Activity Log */}
      {booking.table_booking_modifications && booking.table_booking_modifications.length > 0 && (
        <Section title="Activity Log" className="mt-6">
          <Card>
            <div className="space-y-2">
              {booking.table_booking_modifications.map((mod: any) => (
                <div key={mod.id} className="text-sm flex items-center gap-2">
                  <span className="text-gray-500">
                    {format(new Date(mod.created_at), 'dd/MM/yyyy HH:mm')}
                  </span>
                  <span className="text-gray-700">{mod.modification_type}</span>
                </div>
              ))}
            </div>
          </Card>
        </Section>
      )}

      {/* Cancel Modal */}
      <Modal
        open={showCancelModal}
        onClose={() => setShowCancelModal(false)}
        title="Cancel Booking"
        footer={
          <div className="flex gap-3">
            <Button
              type="submit"
              form="cancel-form"
              variant="danger"
              disabled={processing || !cancelReason}
              loading={processing}
              fullWidth
            >
              Confirm Cancellation
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={() => setShowCancelModal(false)}
              fullWidth
            >
              Cancel
            </Button>
          </div>
        }
      >
        <Form id="cancel-form" onSubmit={(e) => { e.preventDefault(); handleCancel(); }}>
          <p className="text-gray-600 mb-4">
            Please provide a reason for cancellation:
          </p>
          <FormGroup>
            <Textarea
              value={cancelReason}
              onChange={(e) => setCancelReason(e.target.value)}
              rows={3}
              placeholder="Reason for cancellation..."
              required
            />
          </FormGroup>
          {refundEligibility && refundEligibility.refund_amount > 0 && (
            <Alert variant="info"
              description={`A refund of £${refundEligibility.refund_amount.toFixed(2)} will be processed.`}
              className="mb-4"
            />
          )}
        </Form>
      </Modal>
      </PageContent>
    </PageWrapper>
  );
}