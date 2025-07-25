'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { usePermissions } from '@/contexts/PermissionContext';
import { useSupabase } from '@/components/providers/SupabaseProvider';
import Link from 'next/link';
import { ArrowLeftIcon, UserPlusIcon } from '@heroicons/react/24/outline';
import toast from 'react-hot-toast';
import { enrollLoyaltyMember, getLoyaltyMemberByCustomer } from '@/app/actions/loyalty-members';
import { Loader2 } from 'lucide-react';
import { PageWrapper, PageContent } from '@/components/ui-v2/layout/PageWrapper';
import { PageHeader } from '@/components/ui-v2/layout/PageHeader';

interface Customer {
  id: string;
  name: string;
  email_address: string | null;
  phone_number: string;
}

export default function EnrollCustomerPage() {
  const router = useRouter();
  const { hasPermission } = usePermissions();
  const supabase = useSupabase();
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const [checkingMembership, setCheckingMembership] = useState(false);
  const [isAlreadyMember, setIsAlreadyMember] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (searchTerm.length >= 2) {
      searchCustomers();
    } else {
      setCustomers([]);
    }
  }, [searchTerm]);

  const searchCustomers = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('customers')
        .select('id, name, email_address, phone_number')
        .or(`name.ilike.%${searchTerm}%,phone_number.ilike.%${searchTerm}%,email_address.ilike.%${searchTerm}%`)
        .order('name')
        .limit(20);

      if (error) throw error;
      setCustomers(data || []);
    } catch (error) {
      console.error('Error searching customers:', error);
      toast.error('Failed to search customers');
    } finally {
      setLoading(false);
    }
  };

  const selectCustomer = async (customer: Customer) => {
    setSelectedCustomer(customer);
    setCheckingMembership(true);
    setIsAlreadyMember(false);

    // Check if customer is already a member
    const result = await getLoyaltyMemberByCustomer(customer.id);
    
    if (result.data) {
      setIsAlreadyMember(true);
      toast.error('This customer is already enrolled in the loyalty program');
    }
    
    setCheckingMembership(false);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedCustomer || isAlreadyMember) return;

    setSubmitting(true);
    try {
      const result = await enrollLoyaltyMember({
        customer_id: selectedCustomer.id,
        status: 'active'
      });

      if (result.error) {
        toast.error(result.error);
      } else if (result.success) {
        toast.success(`${selectedCustomer.name} has been enrolled in the VIP Club!`);
        router.push('/loyalty/admin');
      }
    } catch (error) {
      toast.error('Failed to enroll customer');
    } finally {
      setSubmitting(false);
    }
  };

  if (!hasPermission('loyalty', 'manage')) {
    return (
      <PageWrapper>
        <PageHeader
          title="Enroll Customer"
          subtitle="Add an existing customer to The Anchor VIP Club"
          backButton={{ label: "Back to Loyalty", href: "/loyalty/admin" }}
        />
        <PageContent>
          <div className="flex items-center justify-center min-h-[400px]">
            <p className="text-gray-500">You don&apos;t have permission to enroll customers.</p>
          </div>
        </PageContent>
      </PageWrapper>
    );
  }

  return (
    <PageWrapper>
      <PageHeader
        title="Enroll Customer"
        subtitle="Add an existing customer to The Anchor VIP Club"
        backButton={{ label: "Back to Loyalty", href: "/loyalty/admin" }}
      />
      <PageContent>

      {/* Search Form */}
      <div className="bg-white shadow rounded-lg p-6 mb-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Find Customer</h2>
        
        <div className="mb-4">
          <label htmlFor="search" className="block text-sm font-medium text-gray-700 mb-1">
            Search by name, phone, or email
          </label>
          <input
            type="text"
            id="search"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Start typing to search..."
            className="w-full rounded-md border-gray-300 shadow-sm focus:border-amber-500 focus:ring-amber-500"
            autoFocus
          />
        </div>

        {/* Search Results */}
        {loading && (
          <div className="flex items-center justify-center py-4">
            <Loader2 className="h-6 w-6 animate-spin text-amber-600" />
          </div>
        )}

        {!loading && customers.length > 0 && (
          <div className="border rounded-md divide-y">
            {customers.map((customer) => (
              <button
                key={customer.id}
                onClick={() => selectCustomer(customer)}
                className="w-full text-left px-4 py-3 hover:bg-gray-50 focus:bg-gray-50 focus:outline-none transition-colors"
              >
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-medium text-gray-900">{customer.name}</p>
                    <p className="text-sm text-gray-500">
                      {customer.phone_number}
                    </p>
                  </div>
                  <UserPlusIcon className="h-5 w-5 text-gray-400" />
                </div>
              </button>
            ))}
          </div>
        )}

        {!loading && searchTerm.length >= 2 && customers.length === 0 && (
          <p className="text-center text-gray-500 py-4">
            No customers found matching &quot;{searchTerm}&quot;
          </p>
        )}
      </div>

      {/* Selected Customer */}
      {selectedCustomer && (
        <div className="bg-white shadow rounded-lg p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Selected Customer</h2>
          
          <div className="bg-gray-50 rounded-lg p-4 mb-6">
            <h3 className="font-medium text-gray-900">{selectedCustomer.name}</h3>
            <p className="text-sm text-gray-600 mt-1">
              {selectedCustomer.phone_number}
              {selectedCustomer.email_address && ` • ${selectedCustomer.email_address}`}
            </p>
          </div>

          {checkingMembership && (
            <div className="flex items-center justify-center py-4">
              <Loader2 className="h-6 w-6 animate-spin text-amber-600" />
              <span className="ml-2 text-gray-600">Checking membership status...</span>
            </div>
          )}

          {!checkingMembership && isAlreadyMember && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-4">
              <p className="text-red-800">
                This customer is already enrolled in the loyalty program.
              </p>
            </div>
          )}

          {!checkingMembership && !isAlreadyMember && (
            <>
              <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 mb-6">
                <h4 className="font-medium text-amber-900 mb-2">Welcome Benefits</h4>
                <ul className="text-sm text-amber-800 space-y-1">
                  <li>• 50 welcome bonus points</li>
                  <li>• VIP Member status</li>
                  <li>• Access to loyalty portal</li>
                  <li>• SMS event alerts</li>
                  <li>• Birthday month recognition</li>
                </ul>
              </div>

              <form onSubmit={handleSubmit}>
                <div className="flex justify-end space-x-3">
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedCustomer(null);
                      setSearchTerm('');
                      setCustomers([]);
                    }}
                    className="px-4 py-2 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={submitting}
                    className="inline-flex items-center px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-amber-600 hover:bg-amber-700 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {submitting ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin mr-2" />
                        Enrolling...
                      </>
                    ) : (
                      <>
                        <UserPlusIcon className="h-4 w-4 mr-2" />
                        Enroll Customer
                      </>
                    )}
                  </button>
                </div>
              </form>
            </>
          )}
        </div>
      )}

      {/* Info Box */}
      {!selectedCustomer && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
          <h3 className="font-medium text-blue-900 mb-2">How to enroll a customer</h3>
          <ol className="text-sm text-blue-800 space-y-1 list-decimal list-inside">
            <li>Search for the customer by name, phone number, or email</li>
            <li>Select the customer from the search results</li>
            <li>Confirm enrollment to add them to the VIP Club</li>
          </ol>
          <p className="text-sm text-blue-800 mt-3">
            <strong>Note:</strong> Only existing customers can be enrolled. New customers are automatically 
            offered enrollment when they make their first booking.
          </p>
        </div>
      )}
      </PageContent>
    </PageWrapper>
  );
}