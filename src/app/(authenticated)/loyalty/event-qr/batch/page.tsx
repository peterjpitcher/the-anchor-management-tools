'use client'

import { useRouter } from 'next/navigation';

import { useState, useEffect } from 'react';
import { useSupabase } from '@/components/providers/SupabaseProvider';
import { BackButton } from '@/components/ui-v2/navigation/BackButton';
import { generateEventQRCodes, generateUnbookedQRCodes } from '@/app/actions/loyalty-batch-qr';
import { usePermissions } from '@/contexts/PermissionContext';
import Link from 'next/link';
import { 
  QrCodeIcon,
  DocumentArrowDownIcon,
  UsersIcon,
  ClockIcon,
  ArrowLeftIcon,
  PrinterIcon,
  UserPlusIcon
} from '@heroicons/react/24/outline';
import toast from 'react-hot-toast';
import { PageWrapper, PageContent } from '@/components/ui-v2/layout/PageWrapper';
import { PageHeader } from '@/components/ui-v2/layout/PageHeader';

interface Event {
  id: string;
  title: string;
  message: string | null;
  start_date: string;
  end_date: string;
  price: number;
  capacity: number | null;
  category: {
    name: string;
  } | null;
  _count?: {
    bookings: number;
  };
}

export default function BatchQRPage() {
  const router = useRouter();
  const supabase = useSupabase();
  const { hasPermission } = usePermissions();
  const [events, setEvents] = useState<Event[]>([]);
  const [selectedEvent, setSelectedEvent] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [walkInQuantity, setWalkInQuantity] = useState(10);
  const [generationType, setGenerationType] = useState<'bookings' | 'walkins'>('bookings');

  const canManageEvents = hasPermission('events', 'manage');

  useEffect(() => {
    const loadEvents = async () => {
      setLoading(true);
      try {
        // Get upcoming events with booking counts
        const { data, error } = await supabase
          .from('events')
          .select(`
            *,
            category:event_categories(name),
            bookings(count)
          `)
          .gte('start_date', new Date().toISOString())
          .order('start_date', { ascending: true });

        if (error) throw error;

        // Transform the data to include booking counts
        const eventsWithCounts = (data || []).map((event: any) => ({
          ...event,
          _badge: {
            bookings: event.bookings?.[0]?.count || 0
          }
        }));

        setEvents(eventsWithCounts);
      } catch (error) {
        console.error('Error loading events:', error);
        toast.error('Failed to load events');
      } finally {
        setLoading(false);
      }
    };

    loadEvents();
  }, [supabase]);

  const handleGeneratePDF = async () => {
    if (!selectedEvent) {
      toast.error('Please select an event');
      return;
    }

    setGenerating(true);
    try {
      if (generationType === 'bookings') {
        const result = await generateEventQRCodes({
          event_id: selectedEvent,
          format: 'pdf',
          include_unbooked: false
        });

        if (result.error) {
          toast.error(result.error);
          return;
        }

        if (result.success && result.data?.pdf) {
          // Download the PDF
          const blob = new Blob(
            [Buffer.from(result.data.pdf, 'base64')], 
            { type: 'application/pdf' }
          );
          const url = window.URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = `qr-codes-${result.data.eventName.replace(/\s+/g, '-')}.pdf`;
          document.body.appendChild(a);
          a.click();
          window.URL.revokeObjectURL(url);
          document.body.removeChild(a);

          toast.success(`Generated QR codes for ${result.data.bookingCount} bookings`);
        }
      } else {
        // Generate walk-in QR codes
        const result = await generateUnbookedQRCodes(selectedEvent, walkInQuantity);

        if (result.error) {
          toast.error(result.error);
          return;
        }

        if (result.success && result.data?.pdf) {
          // Download the PDF
          const blob = new Blob(
            [Buffer.from(result.data.pdf, 'base64')], 
            { type: 'application/pdf' }
          );
          const url = window.URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = `walk-in-qr-codes-${result.data.eventName.replace(/\s+/g, '-')}.pdf`;
          document.body.appendChild(a);
          a.click();
          window.URL.revokeObjectURL(url);
          document.body.removeChild(a);

          toast.success(`Generated ${result.data.quantity} walk-in QR codes`);
        }
      }
    } catch (error) {
      console.error('Error generating QR codes:', error);
      toast.error('Failed to generate QR codes');
    } finally {
      setGenerating(false);
    }
  };

  if (!canManageEvents) {
    return (
      <PageWrapper>
        <PageHeader
          title="Batch QR Code Generation"
          subtitle="Generate and download QR codes for all bookings or create walk-in codes"
          backButton={{ label: "Back to Event QR", href: "/loyalty/event-qr" }}
        />
        <PageContent>
          <div className="flex items-center justify-center min-h-[400px]">
            <p className="text-gray-500">You don&apos;t have permission to manage event QR codes.</p>
          </div>
        </PageContent>
      </PageWrapper>
    );
  }

  return (
    <PageWrapper>
      <PageHeader
        title="Batch QR Code Generation"
        subtitle="Generate and download QR codes for all bookings or create walk-in codes"
        backButton={{ label: "Back to Event QR", href: "/loyalty/event-qr" }}
      />
      <PageContent>

      {loading ? (
        <div className="flex justify-center items-center h-64">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-amber-600"></div>
        </div>
      ) : (
        <div className="space-y-6">
          {/* Generation Type Selection */}
          <div className="bg-white shadow rounded-lg p-6">
            <h2 className="text-lg font-medium text-gray-900 mb-4">Generation Type</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <button
                onClick={() => setGenerationType('bookings')}
                className={`p-4 rounded-lg border-2 text-left transition-colors ${
                  generationType === 'bookings'
                    ? 'border-amber-600 bg-amber-50'
                    : 'border-gray-200 hover:border-gray-300'
                }`}
              >
                <UsersIcon className="h-8 w-8 text-amber-600 mb-2" />
                <h3 className="font-medium text-gray-900">Booking QR Codes</h3>
                <p className="text-sm text-gray-600 mt-1">
                  Generate QR codes for all existing bookings
                </p>
              </button>

              <button
                onClick={() => setGenerationType('walkins')}
                className={`p-4 rounded-lg border-2 text-left transition-colors ${
                  generationType === 'walkins'
                    ? 'border-amber-600 bg-amber-50'
                    : 'border-gray-200 hover:border-gray-300'
                }`}
              >
                <UserPlusIcon className="h-8 w-8 text-amber-600 mb-2" />
                <h3 className="font-medium text-gray-900">Walk-in QR Codes</h3>
                <p className="text-sm text-gray-600 mt-1">
                  Generate blank QR codes for walk-in customers
                </p>
              </button>
            </div>
          </div>

          {/* Event Selection */}
          <div className="bg-white shadow rounded-lg p-6">
            <h2 className="text-lg font-medium text-gray-900 mb-4">Select Event</h2>
            {events.length === 0 ? (
              <p className="text-gray-500">No upcoming events found</p>
            ) : (
              <div className="space-y-2">
                {events.map((event) => (
                  <label
                    key={event.id}
                    className={`block p-4 rounded-lg border cursor-pointer transition-colors ${
                      selectedEvent === event.id
                        ? 'border-amber-600 bg-amber-50'
                        : 'border-gray-200 hover:border-gray-300'
                    }`}
                  >
                    <input
                      type="radio"
                      name="event"
                      value={event.id}
                      checked={selectedEvent === event.id}
                      onChange={(e) => setSelectedEvent(e.target.value)}
                      className="sr-only"
                    />
                    <div className="flex justify-between items-start">
                      <div>
                        <h3 className="font-medium text-gray-900">{event.title}</h3>
                        <div className="mt-1 text-sm text-gray-600 space-y-1">
                          <p className="flex items-center">
                            <ClockIcon className="h-4 w-4 mr-1" />
                            {new Date(event.start_date).toLocaleDateString('en-GB', {
                              weekday: 'long',
                              day: 'numeric',
                              month: 'long',
                              year: 'numeric',
                              hour: '2-digit',
                              minute: '2-digit'
                            })}
                          </p>
                          {event.category && (
                            <p>Category: {event.category.name}</p>
                          )}
                          <p className="flex items-center">
                            <UsersIcon className="h-4 w-4 mr-1" />
                            {event._count?.bookings || 0} bookings
                            {event.capacity && ` / ${event.capacity} capacity`}
                          </p>
                        </div>
                      </div>
                      {selectedEvent === event.id && (
                        <div className="text-amber-600">
                          <QrCodeIcon className="h-6 w-6" />
                        </div>
                      )}
                    </div>
                  </label>
                ))}
              </div>
            )}
          </div>

          {/* Walk-in Quantity (only for walk-in type) */}
          {generationType === 'walkins' && (
            <div className="bg-white shadow rounded-lg p-6">
              <h2 className="text-lg font-medium text-gray-900 mb-4">Walk-in Quantity</h2>
              <div className="flex items-center space-x-4">
                <label htmlFor="quantity" className="text-sm font-medium text-gray-700">
                  Number of QR codes to generate:
                </label>
                <input
                  type="number"
                  id="quantity"
                  min="1"
                  max="50"
                  value={walkInQuantity}
                  onChange={(e) => setWalkInQuantity(Math.max(1, Math.min(50, parseInt(e.target.value) || 1)))}
                  className="w-20 rounded-md border-gray-300 shadow-sm focus:border-amber-500 focus:ring-amber-500 sm:text-sm"
                />
              </div>
              <p className="mt-2 text-sm text-gray-500">
                Generate between 1 and 50 walk-in QR codes
              </p>
            </div>
          )}

          {/* Generate Button */}
          <div className="bg-gray-50 rounded-lg p-6">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-lg font-medium text-gray-900">
                  {generationType === 'bookings' 
                    ? 'Generate Booking QR Codes' 
                    : 'Generate Walk-in QR Codes'}
                </h3>
                <p className="mt-1 text-sm text-gray-600">
                  {generationType === 'bookings'
                    ? 'A PDF will be generated with all booking QR codes'
                    : `A PDF will be generated with ${walkInQuantity} walk-in QR codes`}
                </p>
              </div>
              <button
                onClick={handleGeneratePDF}
                disabled={!selectedEvent || generating}
                className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-amber-600 hover:bg-amber-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-amber-500 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {generating ? (
                  <>
                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                    Generating...
                  </>
                ) : (
                  <>
                    <DocumentArrowDownIcon className="h-5 w-5 mr-2" />
                    Generate PDF
                  </>
                )}
              </button>
            </div>
          </div>

          {/* Instructions */}
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
            <h3 className="text-sm font-medium text-blue-900 mb-2 flex items-center">
              <PrinterIcon className="h-5 w-5 mr-2" />
              Printing Instructions
            </h3>
            <ul className="text-sm text-blue-800 space-y-1 list-disc list-inside">
              <li>The PDF is formatted for A4 paper with 2 columns x 3 rows per page</li>
              <li>Each QR code includes customer name and booking details</li>
              <li>Walk-in codes are highlighted with a dashed border for easy identification</li>
              <li>Cut along the lines to create individual QR code cards</li>
            </ul>
          </div>
        </div>
      )}
      </PageContent>
    </PageWrapper>
  );
}