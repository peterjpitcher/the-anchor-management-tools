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
  Alert,
  Button,
  Card,
  ConfirmDialog,
  Empty,
  Field,
  FormFooter,
  Icon,
  IconButton,
  Input,
  Modal,
  PageLayout,
  PageLoading,
  Textarea,
  toast,
  type IconName,
} from '@/ds';
import { useRouter } from 'next/navigation';
import { cn } from '@/lib/utils';
import { CUSTOMER_LABELS_LAYOUT } from '../_shared/layouts';

// Colours staff pick and store on each label: data, not styling tokens. New labels start on the
// first option, so the default can never drift from the list.
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

// value is what a label stores; icon is the DS glyph that draws it.
const PRESET_ICONS: { name: string; value: string; icon: IconName }[] = [
  { name: 'Star', value: 'star', icon: 'star' },
  { name: 'Tag', value: 'tag', icon: 'tag' },
  { name: 'People', value: 'users', icon: 'users' },
  { name: 'Heart', value: 'heart', icon: 'heart' },
  { name: 'Check', value: 'check', icon: 'checkCircle' },
  { name: 'Sparkles', value: 'sparkles', icon: 'sparkles' },
];

function CustomerLabelIcon({ icon, size }: { icon?: string; size: number }) {
  const match = PRESET_ICONS.find((option) => option.value === icon) ?? PRESET_ICONS[0];
  return <Icon name={match.icon} size={size} />;
}

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
  // A reload that fails is shown as an error, never as "no labels yet".
  const [loadError, setLoadError] = useState<string | null>(null);

  const [formData, setFormData] = useState({
    name: '',
    description: '',
    color: PRESET_COLORS[0].value,
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
        setLoadError(result.error);
      } else if (result.data) {
        setLoadError(null);
        setLabels(result.data);
      }
    } catch {
      setLoadError('Failed to load customer labels');
    } finally {
      setLoading(false);
    }
  };

  const resetForm = () => {
    setFormData({
      name: '',
      description: '',
      color: PRESET_COLORS[0].value,
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
        // Report both halves. The run removes stale New Customer labels as well
        // as applying matches, and a message about applications alone hid that.
        const expired = result.expiredNewCustomer ?? 0;
        toast.success(
          expired > 0
            ? `Applied labels to ${result.data.length} customers, and removed New Customer from ${expired}`
            : `Applied labels to ${result.data.length} customers`
        );
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
    <PageLayout
      {...CUSTOMER_LABELS_LAYOUT}
      headerActions={
        canManageUI && (
          <>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => setRetroactiveConfirm(true)}
              icon={<Icon name="sparkles" size={16} />}
              loading={applyingRetroactively}
            >
              Apply Retroactively
            </Button>
            <Button
              size="sm"
              variant="primary"
              onClick={() => setShowForm(true)}
              icon={<Icon name="plus" size={16} />}
            >
              New Label
            </Button>
          </>
        )
      }
    >
      {!canManageUI && (
        <Alert tone="info" title="Read-only access">
          You can view customer labels but need the customers:manage permission to create, edit, or delete them.
        </Alert>
      )}

      {loading ? (
        <PageLoading inline label="Loading customer labels" />
      ) : loadError && labels.length === 0 ? (
        <Alert tone="danger" title="Could not load customer labels">{loadError}</Alert>
      ) : labels.length === 0 ? (
        <Card>
          <Empty
            size="sm"
            icon={<Icon name="tag" size={48} />}
            title="No customer labels yet"
            description="Create labels to segment and target your customers more effectively."
            action={
              canManageUI ? (
                <Button variant="primary" onClick={() => setShowForm(true)} icon={<Icon name="plus" size={16} />}>
                  Create Your First Label
                </Button>
              ) : undefined
            }
          />
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {labels.map((label) => (
            <Card key={label.id} padding="sm">
              <div className="flex items-start justify-between">
                <div>
                  <div className="flex items-center space-x-2">
                    <span
                      className="h-8 w-8 flex items-center justify-center rounded-full text-primary-fg"
                      style={{ backgroundColor: label.color }}
                    >
                      <CustomerLabelIcon icon={label.icon} size={16} />
                    </span>
                    <div>
                      <p className="text-sm font-medium text-text">{label.name}</p>
                      {label.description && (
                        <p className="text-xs text-text-muted">{label.description}</p>
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
                      <Icon name="edit" size={16} />
                    </IconButton>
                    <IconButton
                      variant="secondary"
                      size="sm"
                      aria-label="Delete label"
                      onClick={() => setDeleteConfirm(label)}
                    >
                      <Icon name="trash" size={16} />
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
          <form onSubmit={handleSubmit} className="space-y-4">
            <Input
              label="Name"
              required
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              disabled={!canManageUI}
            />
            <Textarea
              label="Description"
              value={formData.description}
              onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              disabled={!canManageUI}
            />

            <Field label="Colour">
              <div role="group" aria-label="Colour" className="grid grid-cols-4 gap-2">
                {PRESET_COLORS.map((color) => {
                  const selected = formData.color === color.value;
                  return (
                    <Button
                      key={color.value}
                      type="button"
                      variant="ghost"
                      aria-pressed={selected}
                      // The swatch is the saved colour itself (data, not a token), so it is set inline.
                      style={{ backgroundColor: color.value }}
                      className={cn('h-9 w-full', selected ? 'border-2 border-text-strong' : 'border-border')}
                      onClick={() => {
                        if (!canManageUI) {
                          toast.error('You do not have permission to update customer labels.');
                          return;
                        }
                        setFormData({ ...formData, color: color.value });
                      }}
                      disabled={!canManageUI}
                    >
                      {selected && <Icon name="check" size={16} className="text-primary-fg" />}
                      <span className="sr-only">{color.name}</span>
                    </Button>
                  );
                })}
              </div>
            </Field>

            <Field label="Icon">
              <div role="group" aria-label="Icon" className="grid grid-cols-3 gap-2">
                {PRESET_ICONS.map((icon) => {
                  const selected = formData.icon === icon.value;
                  return (
                    <Button
                      key={icon.value}
                      type="button"
                      variant="secondary"
                      aria-pressed={selected}
                      className={cn('h-10 w-full', selected && 'border-primary bg-primary-soft text-primary-soft-fg')}
                      icon={<Icon name={icon.icon} size={16} />}
                      onClick={() => {
                        if (!canManageUI) {
                          toast.error('You do not have permission to update customer labels.');
                          return;
                        }
                        setFormData({ ...formData, icon: icon.value });
                      }}
                      disabled={!canManageUI}
                    >
                      {icon.name}
                    </Button>
                  );
                })}
              </div>
            </Field>

            <FormFooter>
              <Button type="button" variant="secondary" onClick={resetForm}>
                Cancel
              </Button>
              <Button type="submit" variant="primary" disabled={!canManageUI}>
                {editingLabel ? 'Update Label' : 'Create Label'}
              </Button>
            </FormFooter>
          </form>
        </Modal>
      )}

      {deleteConfirm && (
        <ConfirmDialog
          open
          title="Delete Label"
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
          title="Apply Labels Retroactively"
          message="This scans customer activity and applies labels where the rules match. It also removes the New Customer label from anyone who is no longer new, so some customers will lose that label. Continue?"
          confirmText="Apply and Tidy Labels"
          confirmVariant="primary"
          onClose={() => setRetroactiveConfirm(false)}
          onConfirm={() => void handleApplyRetroactively()}
        />
      )}
    </PageLayout>
  );
}
