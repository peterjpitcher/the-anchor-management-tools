'use client';

import { useState, useEffect } from 'react';
import { useSupabase } from '@/components/providers/SupabaseProvider';
import { usePermissions } from '@/contexts/PermissionContext';
import { PencilIcon } from '@heroicons/react/24/outline';
import { getBookingPolicies, updateBookingPolicy } from '@/app/actions/table-configuration';
import { BookingPolicy } from '@/types/table-bookings';

// UI v2 Components
import { Page } from '@/components/ui-v2/layout/Page';
import { Card } from '@/components/ui-v2/layout/Card';
import { Section } from '@/components/ui-v2/layout/Section';
import { LinkButton } from '@/components/ui-v2/navigation/LinkButton';
import { Button } from '@/components/ui-v2/forms/Button';
import { Input } from '@/components/ui-v2/forms/Input';
import { Select } from '@/components/ui-v2/forms/Select';
import { FormGroup } from '@/components/ui-v2/forms/FormGroup';
import { Alert } from '@/components/ui-v2/feedback/Alert';
import { Spinner } from '@/components/ui-v2/feedback/Spinner';
import { Modal } from '@/components/ui-v2/overlay/Modal';
import { toast } from '@/components/ui-v2/feedback/Toast';

export default function BookingPoliciesPage() {
  const supabase = useSupabase();
  const { hasPermission } = usePermissions();
  const [policies, setPolicies] = useState<BookingPolicy[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editingType, setEditingType] = useState<'regular' | 'sunday_lunch' | null>(null);
  const [processing, setProcessing] = useState(false);
  const [formData, setFormData] = useState<Partial<BookingPolicy>>({});

  const canManage = hasPermission('table_bookings', 'manage');

  useEffect(() => {
    if (canManage) {
      loadPolicies();
    }
  }, [canManage]);

  async function loadPolicies() {
    try {
      setLoading(true);
      setError(null);

      const result = await getBookingPolicies();
      
      if (result.error) throw new Error(result.error);
      
      // If no policies exist, create defaults
      if (!result.data || result.data.length === 0) {
        const defaultPolicies = [
          {
            booking_type: 'regular' as const,
            full_refund_hours: 48,
            partial_refund_hours: 24,
            partial_refund_percentage: 50,
            modification_allowed: true,
            cancellation_fee: 0,
            max_party_size: 20,
            min_advance_hours: 2,
            max_advance_days: 56,
          },
          {
            booking_type: 'sunday_lunch' as const,
            full_refund_hours: 72,
            partial_refund_hours: 48,
            partial_refund_percentage: 50,
            modification_allowed: true,
            cancellation_fee: 0,
            max_party_size: 20,
            min_advance_hours: 25, // 1pm Saturday cutoff
            max_advance_days: 56,
          }
        ];

        // Create default policies
        for (const policy of defaultPolicies) {
          const formData = new FormData();
          Object.entries(policy).forEach(([key, value]) => {
            formData.append(key, value.toString());
          });
          await updateBookingPolicy(formData);
        }
        
        // Reload after creating defaults
        await loadPolicies();
        return;
      }
      
      setPolicies(result.data);
    } catch (err: any) {
      console.error('Error loading policies:', err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleUpdatePolicy(e: React.FormEvent) {
    e.preventDefault();
    if (!editingType) return;
    
    try {
      setProcessing(true);
      setError(null);

      const form = new FormData();
      form.append('booking_type', editingType);
      Object.entries(formData).forEach(([key, value]) => {
        if (value !== undefined) {
          form.append(key, value.toString());
        }
      });

      const result = await updateBookingPolicy(form);
      
      if (result.error) {
        toast.error(result.error);
      } else {
        await loadPolicies();
        setEditingType(null);
        setFormData({});
        toast.success('Policy updated successfully');
      }
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setProcessing(false);
    }
  }

  function getPolicyForType(type: 'regular' | 'sunday_lunch'): BookingPolicy | undefined {
    return policies.find(p => p.booking_type === type);
  }

  if (!canManage) {
    return (
      <Page title="Booking Policies">
        <Alert variant="error">
          You do not have permission to manage booking policies.
        </Alert>
      </Page>
    );
  }

  if (loading) {
    return (
      <Page title="Booking Policies">
        <div className="flex items-center justify-center min-h-[400px]">
          <Spinner size="lg" />
        </div>
      </Page>
    );
  }

  const PolicyCard = ({ type, title }: { type: 'regular' | 'sunday_lunch', title: string }) => {
    const policy = getPolicyForType(type);
    if (!policy) return null;

    return (
      <Card>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">{title}</h2>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              setEditingType(type);
              setFormData(policy);
            }}
            leftIcon={<PencilIcon className="h-4 w-4" />}
          >
            Edit
          </Button>
        </div>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <p className="text-gray-600">Full Refund Period</p>
              <p className="font-semibold">{policy.full_refund_hours} hours before booking</p>
            </div>
            <div>
              <p className="text-gray-600">Partial Refund Period</p>
              <p className="font-semibold">{policy.partial_refund_hours} hours ({policy.partial_refund_percentage}% refund)</p>
            </div>
            <div>
              <p className="text-gray-600">Modifications Allowed</p>
              <p className="font-semibold">{policy.modification_allowed ? 'Yes' : 'No'}</p>
            </div>
            <div>
              <p className="text-gray-600">Cancellation Fee</p>
              <p className="font-semibold">£{policy.cancellation_fee}</p>
            </div>
            <div>
              <p className="text-gray-600">Max Party Size</p>
              <p className="font-semibold">{policy.max_party_size} people</p>
            </div>
            <div>
              <p className="text-gray-600">{type === 'sunday_lunch' ? 'Order Cutoff' : 'Minimum Notice'}</p>
              <p className="font-semibold">
                {policy.min_advance_hours} hours
                {type === 'sunday_lunch' && ' (1pm Saturday)'}
              </p>
            </div>
            <div>
              <p className="text-gray-600">Book Up To</p>
              <p className="font-semibold">{policy.max_advance_days} days in advance</p>
            </div>
          </div>
        </div>
      </Card>
    );
  };

  return (
    <Page 
      title="Booking Policies"
      description="Configure refund policies and booking rules"
    >
      <LinkButton href="/table-bookings/settings" variant="secondary">Back to Settings</LinkButton>

      {error && (
        <Alert variant="error" className="mt-4">
          {error}
        </Alert>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mt-6">
        <PolicyCard type="regular" title="Regular Bookings" />
        <PolicyCard type="sunday_lunch" title="Sunday Lunch Bookings" />
      </div>

      {/* Edit Policy Modal */}
      <Modal
        open={!!editingType}
        onClose={() => {
          setEditingType(null);
          setFormData({});
        }}
        title={`Edit ${editingType === 'regular' ? 'Regular' : 'Sunday Lunch'} Booking Policy`}
      >
        <form onSubmit={handleUpdatePolicy} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <FormGroup label="Full Refund Hours" required>
              <Input
                type="number"
                value={formData.full_refund_hours || ''}
                onChange={(e) => setFormData({ ...formData, full_refund_hours: parseInt(e.target.value) })}
                min={0}
                required
              />
            </FormGroup>
            <FormGroup label="Partial Refund Hours" required>
              <Input
                type="number"
                value={formData.partial_refund_hours || ''}
                onChange={(e) => setFormData({ ...formData, partial_refund_hours: parseInt(e.target.value) })}
                min={0}
                required
              />
            </FormGroup>
          </div>

          <FormGroup label="Partial Refund Percentage" required>
            <Input
              type="number"
              value={formData.partial_refund_percentage || ''}
              onChange={(e) => setFormData({ ...formData, partial_refund_percentage: parseInt(e.target.value) })}
              min={0}
              max={100}
              required
            />
          </FormGroup>

          <FormGroup label="Modifications Allowed" required>
            <Select
              value={formData.modification_allowed ? 'true' : 'false'}
              onChange={(e) => setFormData({ ...formData, modification_allowed: e.target.value === 'true' })}
            >
              <option value="true">Yes</option>
              <option value="false">No</option>
            </Select>
          </FormGroup>

          <FormGroup label="Cancellation Fee (£)" required>
            <Input
              type="number"
              value={formData.cancellation_fee || ''}
              onChange={(e) => setFormData({ ...formData, cancellation_fee: parseFloat(e.target.value) })}
              min={0}
              step={0.01}
              required
            />
          </FormGroup>

          <FormGroup label="Maximum Party Size" required>
            <Input
              type="number"
              value={formData.max_party_size || ''}
              onChange={(e) => setFormData({ ...formData, max_party_size: parseInt(e.target.value) })}
              min={1}
              required
            />
          </FormGroup>

          <FormGroup 
            label={editingType === 'sunday_lunch' ? 'Order Cutoff (hours before)' : 'Minimum Advance Hours'} 
            required
            help={editingType === 'sunday_lunch' ? 'Hours before Sunday lunch when orders must be placed' : 'Minimum hours in advance a booking can be made'}
          >
            <Input
              type="number"
              value={formData.min_advance_hours || ''}
              onChange={(e) => setFormData({ ...formData, min_advance_hours: parseInt(e.target.value) })}
              min={0}
              required
            />
          </FormGroup>

          <FormGroup label="Maximum Advance Days" required>
            <Input
              type="number"
              value={formData.max_advance_days || ''}
              onChange={(e) => setFormData({ ...formData, max_advance_days: parseInt(e.target.value) })}
              min={1}
              required
            />
          </FormGroup>

          <div className="flex gap-3 pt-4">
            <Button
              type="submit"
              disabled={processing}
              loading={processing}
              fullWidth
            >
              Update Policy
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                setEditingType(null);
                setFormData({});
              }}
              fullWidth
            >
              Cancel
            </Button>
          </div>
        </form>
      </Modal>
    </Page>
  );
}