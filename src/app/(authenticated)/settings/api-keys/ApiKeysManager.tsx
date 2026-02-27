'use client';

import { useState } from 'react';
import { DocumentDuplicateIcon, PlusIcon, PencilIcon } from '@heroicons/react/24/outline';
import { Button, IconButton } from '@/components/ui-v2/forms/Button';
import { Input } from '@/components/ui-v2/forms/Input';
import { Checkbox } from '@/components/ui-v2/forms/Checkbox';
import { Card } from '@/components/ui-v2/layout/Card';
import { Badge } from '@/components/ui-v2/display/Badge';
import { DataTable } from '@/components/ui-v2/display/DataTable';
import toast from 'react-hot-toast';
import { generateApiKey, updateApiKey } from './actions';
import { format } from 'date-fns';
import type { ApiKey } from '@/types/api';
import { Alert } from '@/components/ui-v2/feedback/Alert';

interface ApiKeysManagerProps {
  initialKeys: ApiKey[];
  canManage: boolean;
}

const PERMISSION_OPTIONS = [
  { value: 'read:events', label: 'Read Events' },
  { value: 'write:events', label: 'Write Events' },
  { value: 'write:performers', label: 'Write Performers' },
  { value: 'read:menu', label: 'Read Menu' },
  { value: 'write:menu', label: 'Write Menu' },
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
        <label htmlFor="key-name" className="block text-sm font-medium text-gray-700">Name *</label>
        <Input
          type="text"
          id="key-name"
          required
          placeholder="e.g., Website Integration"
          value={formData.name}
          onChange={(e) => setFormData({ ...formData, name: e.target.value })}
          fullWidth
        />
      </div>

      <div>
        <label htmlFor="key-description" className="block text-sm font-medium text-gray-700">Description</label>
        <Input
          type="text"
          id="key-description"
          placeholder="Optional description"
          value={formData.description}
          onChange={(e) => setFormData({ ...formData, description: e.target.value })}
          fullWidth
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">Permissions</label>
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
        <label htmlFor="key-rate-limit" className="block text-sm font-medium text-gray-700">
          Rate Limit (requests per hour)
        </label>
        <Input
          type="number"
          id="key-rate-limit"
          value={formData.rate_limit}
          onChange={(e) => setFormData({ ...formData, rate_limit: parseInt(e.target.value) || 1000 })}
          fullWidth
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
        <Card variant="default" padding="md">
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
        <Card variant="default" padding="md">
          <h3 className="text-lg font-semibold mb-1">Edit API Key</h3>
          <p className="text-sm text-gray-500 mb-4">
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
        <Card variant="default" padding="sm" className="bg-yellow-50 border-yellow-200">
          <h3 className="font-semibold text-yellow-900 mb-2">New API Key Created</h3>
          <p className="text-sm text-yellow-800 mb-3">
            Save this key now. You won&apos;t be able to see it again.
          </p>
          <div className="flex items-center space-x-2">
            <code className="flex-1 bg-white p-2 rounded border border-yellow-300 font-mono text-sm">
              {showKey}
            </code>
            <IconButton
              variant="secondary"
              onClick={() => handleCopyKey(showKey)}
              className="hover:bg-yellow-100"
            >
              <DocumentDuplicateIcon className="h-5 w-5 text-yellow-700" />
            </IconButton>
          </div>
        </Card>
      )}

      {/* API Keys Table */}
      <Card variant="default" padding="none">
        <DataTable<ApiKey>
          data={keys}
          getRowKey={(k) => k.id}
          emptyMessage="No API keys yet"
          columns={[
            { key: 'name', header: 'Name', cell: (k: ApiKey) => (
              <div>
                <div className="text-sm font-medium text-gray-900">{k.name}</div>
                {k.description && <div className="text-sm text-gray-500">{k.description}</div>}
              </div>
            ) },
            { key: 'permissions', header: 'Permissions', cell: (k: ApiKey) => (
              <div className="text-sm text-gray-900">{k.permissions.includes('*') ? 'All permissions' : k.permissions.join(', ')}</div>
            ) },
            { key: 'rate', header: 'Rate Limit', align: 'right', cell: (k: ApiKey) => <span className="text-sm text-gray-900">{k.rate_limit}/hour</span> },
            { key: 'last', header: 'Last Used', cell: (k: ApiKey) => <span className="text-sm text-gray-500">{k.last_used_at ? format(new Date(k.last_used_at), 'MMM d, yyyy HH:mm') : 'Never'}</span> },
            { key: 'status', header: 'Status', cell: (k: ApiKey) => <Badge variant={k.is_active ? 'success' : 'error'}>{k.is_active ? 'Active' : 'Inactive'}</Badge> },
            ...(canManage ? [{
              key: 'actions',
              header: '',
              align: 'right' as const,
              cell: (k: ApiKey) => (
                <IconButton
                  variant="ghost"
                  onClick={() => { setEditingKeyId(k.id); setShowCreateForm(false); }}
                  title="Edit key details"
                >
                  <PencilIcon className="h-4 w-4" />
                </IconButton>
              ),
            }] : []),
          ]}
        />
      </Card>

      {/* Usage Instructions */}
      <Card variant="default" padding="md" className="bg-gray-50">
        <h3 className="text-lg font-semibold mb-4">API Usage</h3>
        <div className="space-y-3">
          <div>
            <h4 className="font-medium mb-1">Authentication</h4>
            <p className="text-sm text-gray-600 mb-2">
              Include your API key in the Authorization header:
            </p>
            <code className="block bg-gray-900 text-gray-100 p-3 rounded text-sm">
              Authorization: Bearer YOUR_API_KEY
            </code>
          </div>

          <div>
            <h4 className="font-medium mb-1">Example Request</h4>
            <code className="block bg-gray-900 text-gray-100 p-3 rounded text-sm whitespace-pre">
{`curl -H "Authorization: Bearer YOUR_API_KEY" \\
  ${process.env.NEXT_PUBLIC_APP_URL || 'https://management.orangejelly.co.uk'}/api/events`}
            </code>
          </div>

          <div>
            <h4 className="font-medium mb-1">Available Endpoints</h4>
            <ul className="text-sm text-gray-600 space-y-1">
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
