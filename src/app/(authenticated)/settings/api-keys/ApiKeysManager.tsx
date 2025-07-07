'use client';

import { useState } from 'react';
import { DocumentDuplicateIcon, PlusIcon } from '@heroicons/react/24/outline';
import { Button } from '@/components/ui/Button';
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
    } catch (error) {
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
        <Button onClick={() => setShowCreateForm(true)}>
          <PlusIcon className="h-4 w-4 mr-2" />
          Create API Key
        </Button>
      )}

      {/* Create Form */}
      {showCreateForm && (
        <div className="bg-white shadow sm:rounded-lg p-6">
          <h3 className="text-lg font-semibold mb-4">Create New API Key</h3>
          <form onSubmit={handleCreateKey} className="space-y-4">
            <div>
              <label htmlFor="name" className="block text-sm font-medium text-gray-700">
                Name *
              </label>
              <input
                type="text"
                id="name"
                required
                className="mt-1 block w-full rounded-lg border-gray-300 shadow-sm focus:border-green-500 focus:ring-green-500 sm:text-sm"
                placeholder="e.g., Website Integration"
                value={newKeyData.name}
                onChange={(e) => setNewKeyData({ ...newKeyData, name: e.target.value })}
              />
            </div>
            
            <div>
              <label htmlFor="description" className="block text-sm font-medium text-gray-700">
                Description
              </label>
              <input
                type="text"
                id="description"
                className="mt-1 block w-full rounded-lg border-gray-300 shadow-sm focus:border-green-500 focus:ring-green-500 sm:text-sm"
                placeholder="Optional description"
                value={newKeyData.description}
                onChange={(e) => setNewKeyData({ ...newKeyData, description: e.target.value })}
              />
            </div>
            
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Permissions
              </label>
              <div className="space-y-2">
                {PERMISSION_OPTIONS.map(option => (
                  <label key={option.value} className="flex items-center">
                    <input
                      type="checkbox"
                      checked={newKeyData.permissions.includes(option.value)}
                      onChange={() => handleTogglePermission(option.value)}
                      className="rounded border-gray-300 text-green-600 focus:ring-green-500"
                    />
                    <span className="ml-2 text-sm text-gray-700">{option.label}</span>
                  </label>
                ))}
              </div>
            </div>
            
            <div>
              <label htmlFor="rate_limit" className="block text-sm font-medium text-gray-700">
                Rate Limit (requests per hour)
              </label>
              <input
                type="number"
                id="rate_limit"
                className="mt-1 block w-full rounded-lg border-gray-300 shadow-sm focus:border-green-500 focus:ring-green-500 sm:text-sm"
                value={newKeyData.rate_limit}
                onChange={(e) => setNewKeyData({ ...newKeyData, rate_limit: parseInt(e.target.value) || 1000 })}
              />
            </div>
            
            <div className="flex gap-3">
              <Button type="submit" disabled={!newKeyData.name || isCreating}>
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
        </div>
      )}

      {/* Show newly created key */}
      {showKey && (
        <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
          <h3 className="font-semibold text-yellow-900 mb-2">New API Key Created</h3>
          <p className="text-sm text-yellow-800 mb-3">
            Save this key now. You won&apos;t be able to see it again.
          </p>
          <div className="flex items-center space-x-2">
            <code className="flex-1 bg-white p-2 rounded border border-yellow-300 font-mono text-sm">
              {showKey}
            </code>
            <button
              className="p-2 hover:bg-yellow-100 rounded"
              onClick={() => handleCopyKey(showKey)}
            >
              <DocumentDuplicateIcon className="h-5 w-5 text-yellow-700" />
            </button>
          </div>
        </div>
      )}

      {/* API Keys Table */}
      <div className="bg-white rounded-lg shadow overflow-hidden">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Name
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Permissions
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Rate Limit
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Last Used
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Status
              </th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {keys.map((key) => (
              <tr key={key.id}>
                <td className="px-6 py-4 whitespace-nowrap">
                  <div>
                    <div className="text-sm font-medium text-gray-900">
                      {key.name}
                    </div>
                    {key.description && (
                      <div className="text-sm text-gray-500">{key.description}</div>
                    )}
                  </div>
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                  <div className="text-sm text-gray-900">
                    {key.permissions.includes('*') 
                      ? 'All permissions'
                      : key.permissions.join(', ')}
                  </div>
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                  {key.rate_limit}/hour
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                  {key.last_used_at 
                    ? format(new Date(key.last_used_at), 'MMM d, yyyy HH:mm')
                    : 'Never'}
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                  <span className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${
                    key.is_active 
                      ? 'bg-green-100 text-green-800' 
                      : 'bg-red-100 text-red-800'
                  }`}>
                    {key.is_active ? 'Active' : 'Inactive'}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Usage Instructions */}
      <div className="bg-gray-50 rounded-lg p-6">
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
      </div>
    </div>
  );
}