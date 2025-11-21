'use client';

import { useState } from 'react';
import { usePermissions } from '@/contexts/PermissionContext';
import Link from 'next/link';
import { 
  ArrowLeftIcon,
  MagnifyingGlassIcon,
  CalendarIcon,
  UserIcon,
  PhoneIcon,
  CheckCircleIcon,
  ExclamationCircleIcon,
  XCircleIcon
} from '@heroicons/react/24/outline';
import { TableBooking } from '@/types/table-bookings';
import { format } from 'date-fns';
import { searchTableBookings } from '@/app/actions/table-bookings';
// New UI components
import { PageLayout } from '@/components/ui-v2/layout/PageLayout';
import { Card } from '@/components/ui-v2/layout/Card';
import { Section } from '@/components/ui-v2/layout/Section';
import { Button } from '@/components/ui-v2/forms/Button';
import { Input } from '@/components/ui-v2/forms/Input';
import { Select } from '@/components/ui-v2/forms/Select';
import { Form } from '@/components/ui-v2/forms/Form';
import { FormGroup } from '@/components/ui-v2/forms/FormGroup';
import { Badge } from '@/components/ui-v2/display/Badge';
import { Alert } from '@/components/ui-v2/feedback/Alert';
import { EmptyState } from '@/components/ui-v2/display/EmptyState';
import { List } from '@/components/ui-v2/display/List';

export default function TableBookingSearchPage() {
  const { hasPermission } = usePermissions();
  const [searchTerm, setSearchTerm] = useState('');
  const [searchType, setSearchType] = useState<'name' | 'phone' | 'reference'>('name');
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState<TableBooking[]>([]);
  const [hasSearched, setHasSearched] = useState(false);

  const canView = hasPermission('table_bookings', 'view');

  async function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    
    if (!searchTerm.trim()) {
      return;
    }
    
    try {
      setSearching(true);
      setHasSearched(true);
      
      const result = await searchTableBookings(searchTerm, searchType);
      
      if (result.error) {
        console.error('Search error:', result.error);
        setResults([]);
      } else {
        setResults(result.data || []);
      }
    } catch (err) {
      console.error('Search error:', err);
      setResults([]);
    } finally {
      setSearching(false);
    }
  }

  if (!canView) {
    return (
      <PageLayout
        title="Search Table Bookings"
        subtitle="Find bookings by name, phone, or reference"
        backButton={{ label: "Back to Table Bookings", href: "/table-bookings" }}
      >
        <Card>
          <Alert variant="error" title="Access Denied" description="You do not have permission to search bookings." />
        </Card>
      </PageLayout>
    );
  }

  return (
    <PageLayout
      title="Search Table Bookings"
      subtitle="Find bookings by name, phone, or reference"
      backButton={{
        label: "Back to Table Bookings",
        href: "/table-bookings"
      }}
    >
      <Card>
        <Form onSubmit={handleSearch}>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <FormGroup label="Search by">
              <Select
                value={searchType}
                onChange={(e) => setSearchType(e.target.value as 'name' | 'phone' | 'reference')}
              >
                <option value="name">Customer Name</option>
                <option value="phone">Phone Number</option>
                <option value="reference">Booking Reference</option>
              </Select>
            </FormGroup>
            
            <div className="md:col-span-2">
              <FormGroup label="Search term">
                <div className="flex gap-2">
                  <Input
                    type="text"
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    placeholder={
                      searchType === 'name' ? 'John Smith' :
                      searchType === 'phone' ? '07700900000' :
                      'TB-2024-0001'
                    }
                    className="flex-1"
                  />
                  <Button
                    type="submit"
                    disabled={searching}
                    loading={searching}
                  >
                    <MagnifyingGlassIcon className="h-5 w-5 mr-2" />
                    Search
                  </Button>
                </div>
              </FormGroup>
            </div>
          </div>
        </Form>
      </Card>

      {/* Results */}
      {hasSearched && (
        <Section
          title={`${results.length} ${results.length === 1 ? 'result' : 'results'} found`}
          className="mt-6"
        >
          <Card>
            {results.length === 0 ? (
              <EmptyState
                title="No results found"
                description="No bookings found matching your search criteria"
              />
            ) : (
              <div>
                {results.map((booking) => (
                  <Link
                    key={booking.id}
                    href={`/table-bookings/${booking.id}`}
                    className="block p-4 hover:bg-gray-50 transition-colors border-b last:border-b-0"
                  >
                    <div className="flex items-start justify-between">
                      <div className="space-y-2">
                        <div className="flex items-center gap-4">
                          <div className="flex items-center gap-2">
                            <UserIcon className="h-4 w-4 text-gray-400" />
                            <span className="font-medium">
                              {booking.customer?.first_name} {booking.customer?.last_name}
                            </span>
                          </div>
                          <div className="flex items-center gap-2 text-sm text-gray-600">
                            <PhoneIcon className="h-4 w-4 text-gray-400" />
                            {booking.customer?.mobile_number}
                          </div>
                        </div>
                        
                        <div className="flex items-center gap-4 text-sm">
                          <div className="flex items-center gap-2">
                            <CalendarIcon className="h-4 w-4 text-gray-400" />
                            {format(new Date(booking.booking_date), 'EEE, d MMM yyyy')}
                            at {booking.booking_time}
                          </div>
                          <div>
                            Party of {booking.party_size}
                          </div>
                          {booking.booking_type === 'sunday_lunch' && (
                            <Badge variant="info" size="sm">
                              Sunday Lunch
                            </Badge>
                          )}
                        </div>
                        
                        <div className="text-sm text-gray-500">
                          Ref: {booking.booking_reference}
                        </div>
                      </div>
                      
                      <div className="text-sm">
                        {booking.status === 'confirmed' && (
                          <Badge variant="success" size="sm">
                            <CheckCircleIcon className="h-4 w-4 mr-1" />
                            Confirmed
                          </Badge>
                        )}
                        {booking.status === 'pending_payment' && (
                          <Badge variant="warning" size="sm">
                            <ExclamationCircleIcon className="h-4 w-4 mr-1" />
                            Awaiting Payment
                          </Badge>
                        )}
                        {booking.status === 'cancelled' && (
                          <Badge variant="error" size="sm">
                            <XCircleIcon className="h-4 w-4 mr-1" />
                            Cancelled
                          </Badge>
                        )}
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </Card>
        </Section>
      )}
    </PageLayout>
  );
}
