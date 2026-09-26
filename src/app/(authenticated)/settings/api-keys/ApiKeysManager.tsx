'use client';

import { useState } from 'react';
import { DocumentDuplicateIcon, PlusIcon, PencilIcon, NoSymbolIcon, TrashIcon } from '@heroicons/react/24/outline';
import { Button, IconButton } from '@/ds';
import { Input } from '@/ds';
import { Checkbox } from '@/ds';
import { Card } from '@/ds';
import { Badge } from '@/ds';
import { DataTable } from '@/ds';
import toast from 'react-hot-toast';
import { deleteApiKey, generateApiKey, revokeApiKey, updateApiKey } from './actions';
import { formatDateTime } from '@/lib/dateUtils';
import type { ApiKey } from '@/types/api';
import { Alert, ConfirmDialog } from '@/ds';

interface ApiKeysManagerProps {
  initialKeys: ApiKey[];
  canManage: boolean;
}

const PERMISSION_OPTIONS = [
  { value: 'read:events', label: 'Read Events' },
  // Gates GET /api/events/{id}/artwork, the only route that emits the story and
  // print-poster URLs. Listed here so a rotated key can be issued with it: a
  // replacement key created without it leaves artwork import reporting
  // "unavailable" while every other check stays green.
  { value: 'read:events:artwork', label: 'Read Event Artwork' },
  { value: 'write:events', label: 'Write Events' },
  { value: 'write:performers', label: 'Write Performers' },
  { value: 'read:menu', label: 'Read Menu' },
  { value: 'write:menu', label: 'Write Menu' },
  { value: 'read:business', label: 'Read Business Info' },
  { value: 'read:table_bookings', label: 'Read Table Bookings' },
  { value: 'write:table_bookings', label: 'Write Table Bookings' },
  { value: 'payments:capture', label: 'Capture Payments' },
  { value: 'create:bookings', label: 'Create Bookings' },
  { value: 'read:customers', label: 'Read Customers' },
  { value: 'write:customers', label: 'Write Customers' },
  { value: 'write:bookings', label: 'Write Bookings' },
  { value: '*', label: 'All Permissions' },
];

type KeyFormData = {
  name: string;
  description: string;
  permissions: string[];
  rate_limit: number;
};

function KeyForm({
  initial,
  onSubmit,
  onCancel,
  isSaving,
  submitLabel,
}: {
  initial: KeyFormData;
  onSubmit: (data: KeyFormData) => void;
  onCancel: () => void;
  isSaving: boolean;
  submitLabel: string;
}) {
  const [formData, setFormData] = useState<KeyFormData>(initial);

  const handleTogglePermission = (permission: string) => {
    if (permission === '*') {
      setFormData({ ...formData, permissions: ['*'] });
    } else {
      const next = formData.permissions.includes(permission)
        ? formData.permissions.filter(p => p !== permission)
        : [...formData.permissions.filter(p => p !== '*'), permission];
      setFormData({ ...formData, permissions: next });
    }
  };

  return (
    <form
      onSubmit={(e) => { e.preventDefault(); onSubmit(formData); }}
      className="space-y-4"
    >
      <div>
        <Input
          label="Name *"
          type="text"
          id="key-name"
          required
          placeholder="e.g., Website Integration"
          value={formData.name}
          onChange={(e) => setFormData({ ...formData, name: e.target.value })}
        />
      </div>

      <div>
        <Input
          label="Description"
          type="text"
          id="key-description"
          placeholder="Optional description"
          value={formData.description}
          onChange={(e) => setFormData({ ...formData, description: e.target.value })}
        />
      </div>

      <div>
        <p className="mb-2 text-xs font-medium uppercase tracking-wider text-text-muted">Permissions</p>
        <div className="space-y-2">
          {PERMISSION_OPTIONS.map(option => (
            <Checkbox
              key={option.value}
              label={option.label}
              checked={formData.permissions.includes(option.value)}
              onChange={() => handleTogglePermission(option.value)}
            />
          ))}
        </div>
      </div>

      <div>
        <Input
          label="Rate Limit (requests per hour)"
          type="number"
          id="key-rate-limit"
          value={formData.rate_limit}
          onChange={(e) => setFormData({ ...formData, rate_limit: parseInt(e.target.value) || 1000 })}
        />
      </div>

      <div className="flex gap-3">
        <Button type="submit" loading={isSaving} disabled={!formData.name}>
          {isSaving ? 'Saving…' : submitLabel}
        </Button>
        <Button type="button" variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

export default function ApiKeysManager({ initialKeys, canManage }: ApiKeysManagerProps) {
  const [keys, setKeys] = useState(initialKeys);
  const [showKey, setShowKey] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [editingKeyId, setEditingKeyId] = useState<string | null>(null);
  const [isSavingEdit, setIsSavingEdit] = useState(false);
  const [revokeTarget, setRevokeTarget] = useState<ApiKey | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ApiKey | null>(null);
  const [isMutatingKey, setIsMutatingKey] = useState(false);

  const handleCreateKey = async (data: KeyFormData) => {
    if (!canManage) {
      toast.error('You do not have permission to create API keys');
      return;
    }
    setIsCreating(true);
    try {
      const result = await generateApiKey(data);
      if ('error' in result) throw new Error(result.error);
      setKeys([result.apiKey, ...keys]);
      setShowKey(result.plainKey);
      toast.success('API key created successfully');
      setShowCreateForm(false);
    } catch {
      toast.error('Failed to create API key');
    } finally {
      setIsCreating(false);
    }
  };

  const handleUpdateKey = async (keyId: string, data: KeyFormData) => {
    if (!canManage) {
      toast.error('You do not have permission to update API keys');
      return;
    }
    setIsSavingEdit(true);
    try {
      const result = await updateApiKey({ id: keyId, ...data });
      if ('error' in result) throw new Error(result.error);
      setKeys(keys.map(k =>
        k.id === keyId
          ? { ...k, name: data.name, description: data.description || null, permissions: data.permissions, rate_limit: data.rate_limit }
          : k
      ));
      toast.success('API key updated');
      setEditingKeyId(null);
    } catch {
      toast.error('Failed to update API key');
    } finally {
      setIsSavingEdit(false);
    }
  };

  const handleCopyKey = (key: string) => {
    navigator.clipboard.writeText(key);
    toast.success('API key copied to clipboard');
  };

  const handleRevokeKey = async () => {
    if (!revokeTarget) return;
    setIsMutatingKey(true);
    try {
      const result = await revokeApiKey(revokeTarget.id);
      if ('error' in result) throw new Error(result.error);
      setKeys(keys.map(k => k.id === revokeTarget.id ? { ...k, is_active: false } : k));
      toast.success('API key revoked');
      setRevokeTarget(null);
    } catch {
      toast.error('Failed to revoke API key');
    } finally {
      setIsMutatingKey(false);
    }
  };

  const handleDeleteKey = async () => {
    if (!deleteTarget) return;
    setIsMutatingKey(true);
    try {
      const result = await deleteApiKey(deleteTarget.id);
      if ('error' in result) throw new Error(result.error);
      setKeys(keys.filter(k => k.id !== deleteTarget.id));
      toast.success('API key deleted');
      setDeleteTarget(null);
    } catch {
      toast.error('Failed to delete API key');
    } finally {
      setIsMutatingKey(false);
    }
  };

  const editingKey = editingKeyId ? keys.find(k => k.id === editingKeyId) : null;

  return (
    <div className="space-y-6">
      {!canManage && (
        <Alert
          variant="info"
          title="Read-only access"
          description="You can review existing API keys, but creating or revoking keys requires the settings manage permission."
        />
      )}

      {/* Create Button */}
      {canManage && !showCreateForm && !editingKeyId && (
        <Button onClick={() => setShowCreateForm(true)} leftIcon={<PlusIcon className="h-4 w-4" />}>
          Create API Key
        </Button>
      )}

      {/* Create Form */}
      {canManage && showCreateForm && (
        <Card padding="md">
          <h3 className="text-lg font-semibold mb-4">Create New API Key</h3>
          <KeyForm
            initial={{ name: '', description: '', permissions: ['read:events'], rate_limit: 1000 }}
            onSubmit={handleCreateKey}
            onCancel={() => setShowCreateForm(false)}
            isSaving={isCreating}
            submitLabel="Create Key"
          />
        </Card>
      )}

      {/* Edit Form */}
      {canManage && editingKey && (
        <Card padding="md">
          <h3 className="text-lg font-semibold mb-1">Edit API Key</h3>
          <p className="text-sm text-text-muted mb-4">
            The key value itself cannot be changed. Only the name, description, permissions and rate limit can be updated.
          </p>
          <KeyForm
            initial={{
              name: editingKey.name,
              description: editingKey.description ?? '',
              permissions: editingKey.permissions,
              rate_limit: editingKey.rate_limit,
            }}
            onSubmit={(data) => handleUpdateKey(editingKey.id, data)}
            onCancel={() => setEditingKeyId(null)}
            isSaving={isSavingEdit}
            submitLabel="Save Changes"
          />
        </Card>
      )}

      {/* Show newly created key */}
      {showKey && canManage && (
        <Alert tone="warning" title="New API Key Created">
          <p className="mb-3">
            Save this key now. You won&apos;t be able to see it again.
          </p>
          <div className="flex items-center space-x-2">
            <code className="flex-1 break-all rounded-sm border border-warning-border bg-surface p-2 font-mono text-sm text-text">
              {showKey}
            </code>
            <IconButton
              variant="secondary"
              label="Copy API key"
              onClick={() => handleCopyKey(showKey)}
            >
              <DocumentDuplicateIcon className="h-5 w-5 text-warning-fg" />
            </IconButton>
          </div>
        </Alert>
      )}

      {/* API Keys Table */}
      <Card padding="none">
        <DataTable<ApiKey>
          data={keys}
          getRowKey={(k) => k.id}
          emptyMessage="No API keys yet"
          columns={[
            { key: 'name', header: 'Name', cell: (k: ApiKey) => (
              <div>
                <div className="text-sm font-medium text-text">{k.name}</div>
                {k.description && <div className="text-sm text-text-muted">{k.description}</div>}
              </div>
            ) },
            { key: 'permissions', header: 'Permissions', cell: (k: ApiKey) => (
              <div className="text-sm text-text">{k.permissions.includes('*') ? 'All permissions' : k.permissions.join(', ')}</div>
            ) },
            { key: 'rate', header: 'Rate Limit', align: 'right', cell: (k: ApiKey) => <span className="text-sm text-text">{k.rate_limit}/hour</span> },
            { key: 'last', header: 'Last Used', cell: (k: ApiKey) => <span className="text-sm text-text-muted">{k.last_used_at ? formatDateTime(k.last_used_at) : 'Never'}</span> },
            { key: 'status', header: 'Status', cell: (k: ApiKey) => <Badge tone={k.is_active ? 'success' : 'neutral'}>{k.is_active ? 'Active' : 'Inactive'}</Badge> },
            ...(canManage ? [{
              key: 'actions',
              header: '',
              align: 'right' as const,
              cell: (k: ApiKey) => (
                <div className="flex justify-end gap-1">
                  <IconButton
                    variant="ghost"
                    label="Edit key details"
                    onClick={() => { setEditingKeyId(k.id); setShowCreateForm(false); }}
                    title="Edit key details"
                  >
                    <PencilIcon className="h-4 w-4" />
                  </IconButton>
                  {k.is_active && (
                    <IconButton
                      variant="ghost"
                      label="Revoke API key"
                      onClick={() => setRevokeTarget(k)}
                      title="Revoke API key"
                    >
                      <NoSymbolIcon className="h-4 w-4" />
                    </IconButton>
                  )}
                  <IconButton
                    variant="ghost"
                    label="Delete API key"
                    onClick={() => setDeleteTarget(k)}
                    title="Delete API key"
                  >
                    <TrashIcon className="h-4 w-4" />
                  </IconButton>
                </div>
              ),
            }] : []),
          ]}
        />
      </Card>

      <ConfirmDialog
        open={Boolean(revokeTarget)}
        onClose={() => setRevokeTarget(null)}
        onConfirm={handleRevokeKey}
        type="warning"
        title="Revoke API key?"
        message={revokeTarget ? `Revoke ${revokeTarget.name}? Existing integrations using it will stop working.` : 'Revoke this API key?'}
        confirmText="Revoke"
        confirmVariant="danger"
        loading={isMutatingKey}
        loadingText="Revoking..."
        closeOnConfirm={false}
      />

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        onClose={() => setDeleteTarget(null)}
        onConfirm={handleDeleteKey}
        type="danger"
        destructive
        title="Delete API key?"
        message={deleteTarget ? `Delete ${deleteTarget.name}? This cannot be undone.` : 'Delete this API key?'}
        confirmText="Delete"
        loading={isMutatingKey}
        loadingText="Deleting..."
        closeOnConfirm={false}
      />

      {/* Usage Instructions */}
      <Card variant="secondary" padding="md">
        <h3 className="text-lg font-semibold mb-4">API Usage</h3>
        <div className="space-y-3">
          <div>
            <h4 className="font-medium mb-1">Authentication</h4>
            <p className="text-sm text-text-muted mb-2">
              Include your API key in the Authorization header:
            </p>
            <code className="block rounded-sm border border-border bg-surface p-3 font-mono text-sm text-text">
              Authorization: Bearer YOUR_API_KEY
            </code>
          </div>

          <div>
            <h4 className="font-medium mb-1">Example Request</h4>
            <code className="block overflow-x-auto whitespace-pre rounded-sm border border-border bg-surface p-3 font-mono text-sm text-text">
{`curl -H "Authorization: Bearer YOUR_API_KEY" \\
  ${process.env.NEXT_PUBLIC_APP_URL}/api/events`}
            </code>
          </div>

          <div>
            <h4 className="font-medium mb-1">Available Endpoints</h4>
            <ul className="text-sm text-text-muted space-y-1">
              <li>• GET /api/events - List all events</li>
              <li>• GET /api/events/today - Today&apos;s events</li>
              <li>• GET /api/events/[id] - Event details</li>
              <li>• POST /api/events/[id]/check-availability - Check availability</li>
              <li>• POST /api/bookings - Create booking</li>
              <li>• GET /api/menu - Full menu</li>
              <li>• GET /api/menu/specials - Daily specials</li>
              <li>• GET /api/business/hours - Opening hours</li>
              <li>• GET /api/business/amenities - Venue amenities</li>
            </ul>
          </div>
        </div>
      </Card>
    </div>
  );
}
