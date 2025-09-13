'use client';

import { useState } from 'react';
import { DocumentDuplicateIcon, PlusIcon } from '@heroicons/react/24/outline';
import { Button, IconButton } from '@/components/ui-v2/forms/Button';
import { Input } from '@/components/ui-v2/forms/Input';
import { Checkbox } from '@/components/ui-v2/forms/Checkbox';
import { Card } from '@/components/ui-v2/layout/Card';
import { Badge } from '@/components/ui-v2/display/Badge';
import { DataTable } from '@/components/ui-v2/display/DataTable';
import toast from 'react-hot-toast';
import { generateApiKey } from './actions';
import { format } from 'date-fns';
import type { ApiKey } from '@/types/api';

interface ApiKeysManagerProps {
  initialKeys: ApiKey[];
}

const PERMISSION_OPTIONS = [
  { value: 'read:events', label: 'Read Events' },
  { value: 'write:events', label: 'Write Events' },
  { value: 'read:menu', label: 'Read Menu' },
  { value: 'write:menu', label: 'Write Menu' },
  { value: 'write:bookings', label: 'Write Bookings' },
  { value: '*', label: 'All Permissions' },
];

export default function ApiKeysManager({ initialKeys }: ApiKeysManagerProps) {
  const [keys, setKeys] = useState(initialKeys);
  const [showKey, setShowKey] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newKeyData, setNewKeyData] = useState({
    name: '',
    description: '',
    permissions: ['read:events'],
    rate_limit: 1000,
  });

  const handleCreateKey = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsCreating(true);
    try {
      const result = await generateApiKey(newKeyData);
      
      if ('error' in result) {
        throw new Error(result.error);
      }

      setKeys([result.apiKey, ...keys]);
      setShowKey(result.plainKey);
      toast.success('API key created successfully');
      
      // Reset form
      setNewKeyData({
        name: '',
        description: '',
        permissions: ['read:events'],
        rate_limit: 1000,
      });
      setShowCreateForm(false);
  } catch {
      toast.error('Failed to create API key');
    } finally {
      setIsCreating(false);
    }
  };

  const handleCopyKey = (key: string) => {
    navigator.clipboard.writeText(key);
    toast.success('API key copied to clipboard');
  };

  const handleTogglePermission = (permission: string) => {
    if (permission === '*') {
      setNewKeyData({ ...newKeyData, permissions: ['*'] });
    } else {
      const newPermissions = newKeyData.permissions.includes(permission)
        ? newKeyData.permissions.filter(p => p !== permission)
        : [...newKeyData.permissions.filter(p => p !== '*'), permission];
      setNewKeyData({ ...newKeyData, permissions: newPermissions });
    }
  };

  return (
    <div className="space-y-6">
      {/* Create Button */}
      {!showCreateForm && (
        <Button onClick={() => setShowCreateForm(true)} leftIcon={<PlusIcon className="h-4 w-4" />}>
          Create API Key
        </Button>
      )}

      {/* Create Form */}
      {showCreateForm && (
        <Card variant="default" padding="md">
          <h3 className="text-lg font-semibold mb-4">Create New API Key</h3>
          <form onSubmit={handleCreateKey} className="space-y-4">
            <div>
              <label htmlFor="name" className="block text-sm font-medium text-gray-700">
                Name *
              </label>
              <Input
                type="text"
                id="name"
                required
                placeholder="e.g., Website Integration"
                value={newKeyData.name}
                onChange={(e) => setNewKeyData({ ...newKeyData, name: e.target.value })}
                fullWidth
              />
            </div>
            
            <div>
              <label htmlFor="description" className="block text-sm font-medium text-gray-700">
                Description
              </label>
              <Input
                type="text"
                id="description"
                placeholder="Optional description"
                value={newKeyData.description}
                onChange={(e) => setNewKeyData({ ...newKeyData, description: e.target.value })}
                fullWidth
              />
            </div>
            
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Permissions
              </label>
              <div className="space-y-2">
                {PERMISSION_OPTIONS.map(option => (
                  <Checkbox
                    key={option.value}
                    label={option.label}
                    checked={newKeyData.permissions.includes(option.value)}
                    onChange={(_e) => handleTogglePermission(option.value)}
                  />
                ))}
              </div>
            </div>
            
            <div>
              <label htmlFor="rate_limit" className="block text-sm font-medium text-gray-700">
                Rate Limit (requests per hour)
              </label>
              <Input
                type="number"
                id="rate_limit"
                value={newKeyData.rate_limit}
                onChange={(e) => setNewKeyData({ ...newKeyData, rate_limit: parseInt(e.target.value) || 1000 })}
                fullWidth
              />
            </div>
            
            <div className="flex gap-3">
              <Button type="submit" loading={isCreating} disabled={!newKeyData.name}>
                {isCreating ? 'Creating...' : 'Create Key'}
              </Button>
              <Button 
                type="button"
                variant="secondary" 
                onClick={() => setShowCreateForm(false)}
              >
                Cancel
              </Button>
            </div>
          </form>
        </Card>
      )}

      {/* Show newly created key */}
      {showKey && (
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
                {k.description && (<div className="text-sm text-gray-500">{k.description}</div>)}
              </div>
            ) },
            { key: 'permissions', header: 'Permissions', cell: (k: ApiKey) => (
              <div className="text-sm text-gray-900">{k.permissions.includes('*') ? 'All permissions' : k.permissions.join(', ')}</div>
            ) },
            { key: 'rate', header: 'Rate Limit', align: 'right', cell: (k: ApiKey) => <span className="text-sm text-gray-900">{k.rate_limit}/hour</span> },
            { key: 'last', header: 'Last Used', cell: (k: ApiKey) => <span className="text-sm text-gray-500">{k.last_used_at ? format(new Date(k.last_used_at), 'MMM d, yyyy HH:mm') : 'Never'}</span> },
            { key: 'status', header: 'Status', cell: (k: ApiKey) => <Badge variant={k.is_active ? 'success' : 'error'}>{k.is_active ? 'Active' : 'Inactive'}</Badge> },
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
