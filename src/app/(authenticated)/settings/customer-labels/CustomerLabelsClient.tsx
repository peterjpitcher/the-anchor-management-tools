'use client';

import { useEffect, useState } from 'react';
import {
  getCustomerLabels,
  createCustomerLabel,
  updateCustomerLabel,
  deleteCustomerLabel,
  applyLabelsRetroactively,
  type CustomerLabel,
} from '@/app/actions/customer-labels';
import {
  TagIcon,
  PlusIcon,
  PencilIcon,
  TrashIcon,
  SparklesIcon,
  CheckCircleIcon,
} from '@heroicons/react/24/outline';
import { Page } from '@/components/ui-v2/layout/Page';
import { Card } from '@/components/ui-v2/layout/Card';
import { Button, IconButton } from '@/components/ui-v2/forms/Button';
import { Modal } from '@/components/ui-v2/overlay/Modal';
import { Form } from '@/components/ui-v2/forms/Form';
import { FormGroup } from '@/components/ui-v2/forms/FormGroup';
import { Input } from '@/components/ui-v2/forms/Input';
import { Textarea } from '@/components/ui-v2/forms/Textarea';
import { toast } from '@/components/ui-v2/feedback/Toast';
import { Spinner } from '@/components/ui-v2/feedback/Spinner';
import { EmptyState } from '@/components/ui-v2/display/EmptyState';
import { Alert } from '@/components/ui-v2/feedback/Alert';
import { ConfirmDialog } from '@/components/ui-v2/overlay/ConfirmDialog';
import { BackButton } from '@/components/ui-v2/navigation/BackButton';
import { useRouter } from 'next/navigation';

const PRESET_COLORS = [
  { name: 'Green', value: '#10B981' },
  { name: 'Blue', value: '#3B82F6' },
  { name: 'Purple', value: '#8B5CF6' },
  { name: 'Red', value: '#EF4444' },
  { name: 'Yellow', value: '#F59E0B' },
  { name: 'Pink', value: '#EC4899' },
  { name: 'Gray', value: '#6B7280' },
  { name: 'Indigo', value: '#6366F1' },
];

interface CustomerLabelsClientProps {
  initialLabels: CustomerLabel[];
  canManage: boolean;
}

export default function CustomerLabelsClient({ initialLabels, canManage }: CustomerLabelsClientProps) {
  const router = useRouter();
  const [labels, setLabels] = useState<CustomerLabel[]>(initialLabels);
  const [loading, setLoading] = useState(initialLabels.length === 0);
  const [showForm, setShowForm] = useState(false);
  const [editingLabel, setEditingLabel] = useState<CustomerLabel | null>(null);
  const [applyingRetroactively, setApplyingRetroactively] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<CustomerLabel | null>(null);
  const [retroactiveConfirm, setRetroactiveConfirm] = useState(false);

  const [formData, setFormData] = useState({
    name: '',
    description: '',
    color: '#10B981',
    icon: 'star',
    auto_apply_rules: {} as Record<string, unknown>,
  });

  useEffect(() => {
    if (initialLabels.length === 0) {
      void loadLabels();
    }
  }, [initialLabels.length]);

  const loadLabels = async () => {
    setLoading(true);
    try {
      const result = await getCustomerLabels();
      if (result.error) {
        toast.error(result.error);
      } else if (result.data) {
        setLabels(result.data);
      }
    } catch {
      toast.error('Failed to load customer labels');
    } finally {
      setLoading(false);
    }
  };

  const resetForm = () => {
    setFormData({
      name: '',
      description: '',
      color: '#10B981',
      icon: 'star',
      auto_apply_rules: {},
    });
    setEditingLabel(null);
    setShowForm(false);
  };

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();

    if (!canManage) {
      toast.error('You do not have permission to manage customer labels.');
      return;
    }

    try {
      if (editingLabel) {
        const result = await updateCustomerLabel(editingLabel.id, formData);
        if (result.error) {
          toast.error(result.error);
        } else {
          toast.success('Label updated successfully');
          resetForm();
          await loadLabels();
        }
      } else {
        const result = await createCustomerLabel(formData);
        if (result.error) {
          toast.error(result.error);
        } else {
          toast.success('Label created successfully');
          resetForm();
          await loadLabels();
        }
      }
    } catch {
      toast.error('Failed to save label');
    }
  }

  async function handleDelete(label: CustomerLabel) {
    if (!canManage) {
      toast.error('You do not have permission to delete customer labels.');
      return;
    }

    try {
      const result = await deleteCustomerLabel(label.id);
      if (result.error) {
        toast.error(result.error);
      } else {
        toast.success('Label deleted successfully');
        await loadLabels();
      }
      setDeleteConfirm(null);
    } catch {
      toast.error('Failed to delete label');
    }
  }

  async function handleApplyRetroactively() {
    if (!canManage) {
      toast.error('You do not have permission to apply labels retroactively.');
      return;
    }

    setRetroactiveConfirm(false);
    setApplyingRetroactively(true);

    try {
      const result = await applyLabelsRetroactively();
      if (result.error) {
        toast.error(result.error);
      } else if (result.data) {
        toast.success(`Applied labels to ${result.data.length} customers`);
      }
    } catch {
      toast.error('Failed to apply labels retroactively');
    } finally {
      setApplyingRetroactively(false);
    }
  }

  function openEditForm(label: CustomerLabel) {
    if (!canManage) {
      toast.error('You do not have permission to edit customer labels.');
      return;
    }

    setEditingLabel(label);
    setFormData({
      name: label.name,
      description: label.description || '',
      color: label.color,
      icon: label.icon || 'star',
      auto_apply_rules: label.auto_apply_rules || {},
    });
    setShowForm(true);
  }

  const canManageUI = canManage;

  return (
    <Page
      title="Customer Labels"
      description="Organise customers with labels for better targeting and management"
      actions={
        canManageUI && (
          <div className="flex space-x-3">
            <Button
              onClick={() => setShowForm(true)}
              leftIcon={<PlusIcon className="h-5 w-5" />}
            >
              New Label
            </Button>
            <Button
              onClick={() => setRetroactiveConfirm(true)}
              leftIcon={<SparklesIcon className="h-5 w-5" />}
              variant="secondary"
              loading={applyingRetroactively}
            >
              Apply Retroactively
            </Button>
          </div>
        )
      }
      primaryAction={
        <BackButton label="Back to Settings" onBack={() => router.push('/settings')} />
      }
    >
      {!canManageUI && (
        <Card className="mb-4">
          <Alert
            variant="info"
            title="Read-only access"
            description="You can view customer labels but need the customers:manage permission to create, edit, or delete them."
          />
        </Card>
      )}

      {loading ? (
        <div className="flex justify-center py-12">
          <Spinner size="lg" />
        </div>
      ) : labels.length === 0 ? (
        <EmptyState
          icon={<TagIcon className="h-12 w-12" />}
          title="No customer labels yet"
          description="Create labels to segment and target your customers more effectively."
        >
          {canManageUI && (
            <Button onClick={() => setShowForm(true)} leftIcon={<PlusIcon className="h-5 w-5" />}>
              Create your first label
            </Button>
          )}
        </EmptyState>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {labels.map((label) => (
            <Card key={label.id} variant="bordered" padding="sm">
              <div className="flex items-start justify-between">
                <div>
                  <div className="flex items-center space-x-2">
                    <span
                      className="h-8 w-8 flex items-center justify-center rounded-full text-white"
                      style={{ backgroundColor: label.color }}
                    >
                      <TagIcon className="h-4 w-4" />
                    </span>
                    <div>
                      <p className="text-sm font-medium text-gray-900">{label.name}</p>
                      {label.description && (
                        <p className="text-xs text-gray-500">{label.description}</p>
                      )}
                    </div>
                  </div>
                </div>
                {canManageUI && (
                  <div className="flex items-center space-x-1">
                    <IconButton
                      variant="secondary"
                      size="sm"
                      aria-label="Edit label"
                      onClick={() => openEditForm(label)}
                    >
                      <PencilIcon className="h-4 w-4" />
                    </IconButton>
                    <IconButton
                      variant="secondary"
                      size="sm"
                      aria-label="Delete label"
                      onClick={() => setDeleteConfirm(label)}
                    >
                      <TrashIcon className="h-4 w-4" />
                    </IconButton>
                  </div>
                )}
              </div>
            </Card>
          ))}
        </div>
      )}

      {showForm && (
        <Modal
          open={showForm}
          onClose={resetForm}
          title={editingLabel ? 'Edit Customer Label' : 'Create Customer Label'}
        >
          <Form onSubmit={handleSubmit}>
            <FormGroup label="Label Details">
              <Input
                required
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                disabled={!canManageUI}
              />
              <Textarea
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                disabled={!canManageUI}
              />
            </FormGroup>

            <FormGroup label="Color">
              <div className="grid grid-cols-4 gap-2">
                {PRESET_COLORS.map((color) => (
                  <button
                    key={color.value}
                    type="button"
                    className={`h-9 rounded-md border ${
                      formData.color === color.value ? 'ring-2 ring-offset-2 ring-blue-500' : ''
                    }`}
                    style={{ backgroundColor: color.value }}
                    onClick={() => {
                      if (!canManageUI) {
                        toast.error('You do not have permission to update customer labels.');
                        return;
                      }
                      setFormData({ ...formData, color: color.value });
                    }}
                    disabled={!canManageUI}
                  >
                    <span className="sr-only">{color.name}</span>
                  </button>
                ))}
              </div>
            </FormGroup>

            <div className="flex justify-end space-x-2">
              <Button type="button" variant="secondary" onClick={resetForm}>
                Cancel
              </Button>
              <Button type="submit" disabled={!canManageUI}>
                {editingLabel ? 'Update Label' : 'Create Label'}
              </Button>
            </div>
          </Form>
        </Modal>
      )}

      {deleteConfirm && (
        <ConfirmDialog
          open
          title="Delete label"
          message={`Are you sure you want to delete "${deleteConfirm.name}"? This action cannot be undone.`}
          confirmText="Delete"
          confirmVariant="danger"
          type="danger"
          destructive
          onClose={() => setDeleteConfirm(null)}
          onConfirm={() => void handleDelete(deleteConfirm)}
        />
      )}

      {retroactiveConfirm && (
        <ConfirmDialog
          open
          title="Apply labels retroactively"
          message="This will scan recent customer activity and apply labels automatically where rules match. Continue?"
          confirmText="Apply labels"
          confirmVariant="primary"
          onClose={() => setRetroactiveConfirm(false)}
          onConfirm={() => void handleApplyRetroactively()}
        />
      )}
    </Page>
  );
}
