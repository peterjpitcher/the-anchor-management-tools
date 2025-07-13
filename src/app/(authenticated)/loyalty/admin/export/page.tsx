'use client';

import { useState, useEffect } from 'react';
import { usePermissions } from '@/contexts/PermissionContext';
import Link from 'next/link';
import { 
  ArrowLeftIcon, 
  ArrowDownTrayIcon,
  DocumentTextIcon,
  TableCellsIcon,
  FunnelIcon
} from '@heroicons/react/24/outline';
import toast from 'react-hot-toast';
import { exportLoyaltyMembers, getLoyaltyTiers } from '@/app/actions/loyalty-members';
import { Loader2 } from 'lucide-react';
import Papa from 'papaparse';

interface ExportOptions {
  status: '' | 'active' | 'inactive' | 'suspended';
  tier_id: string;
  format: 'csv' | 'json';
}

export default function ExportDataPage() {
  const { hasPermission } = usePermissions();
  const [exporting, setExporting] = useState(false);
  const [tiers, setTiers] = useState<Array<{ id: string; name: string }>>([]);
  const [exportOptions, setExportOptions] = useState<ExportOptions>({
    status: '',
    tier_id: '',
    format: 'csv'
  });
  const [preview, setPreview] = useState<any[]>([]);
  const [totalRecords, setTotalRecords] = useState(0);

  useEffect(() => {
    loadTiers();
    loadPreview();
  }, []);

  useEffect(() => {
    loadPreview();
  }, [exportOptions.status, exportOptions.tier_id]);

  const loadTiers = async () => {
    const result = await getLoyaltyTiers();
    if (result.data) {
      setTiers(result.data);
    }
  };

  const loadPreview = async () => {
    const result = await exportLoyaltyMembers({
      status: exportOptions.status || undefined,
      tier_id: exportOptions.tier_id || undefined
    });
    
    if (result.data) {
      setPreview(result.data.slice(0, 5));
      setTotalRecords(result.data.length);
    }
  };

  const handleExport = async () => {
    setExporting(true);
    
    try {
      const result = await exportLoyaltyMembers({
        status: exportOptions.status || undefined,
        tier_id: exportOptions.tier_id || undefined,
        format: exportOptions.format
      });

      if (result.error) {
        toast.error(result.error);
        return;
      }

      if (!result.data || result.data.length === 0) {
        toast.error('No data to export');
        return;
      }

      // Generate filename
      const timestamp = new Date().toISOString().split('T')[0];
      const statusPart = exportOptions.status ? `_${exportOptions.status}` : '';
      const filename = `loyalty_members${statusPart}_${timestamp}`;

      if (exportOptions.format === 'csv') {
        // Convert to CSV
        const csv = Papa.unparse(result.data);
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${filename}.csv`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        window.URL.revokeObjectURL(url);
      } else {
        // Export as JSON
        const json = JSON.stringify(result.data, null, 2);
        const blob = new Blob([json], { type: 'application/json' });
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${filename}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        window.URL.revokeObjectURL(url);
      }

      toast.success(`Exported ${result.data.length} members`);
    } catch (error) {
      toast.error('Export failed');
    } finally {
      setExporting(false);
    }
  };

  if (!hasPermission('loyalty', 'view')) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <p className="text-gray-500">You don&apos;t have permission to export data.</p>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      {/* Header */}
      <div className="mb-8">
        <div className="flex items-center space-x-4">
          <Link
            href="/loyalty/admin"
            className="inline-flex items-center text-gray-600 hover:text-gray-900"
          >
            <ArrowLeftIcon className="h-5 w-5 mr-1" />
            Back
          </Link>
        </div>
        <h1 className="text-3xl font-bold text-gray-900 mt-4">Export Member Data</h1>
        <p className="mt-2 text-gray-600">
          Download loyalty member data in CSV or JSON format
        </p>
      </div>

      {/* Export Options */}
      <div className="bg-white shadow rounded-lg p-6 mb-6">
        <div className="flex items-center mb-4">
          <FunnelIcon className="h-5 w-5 text-gray-400 mr-2" />
          <h2 className="text-lg font-semibold text-gray-900">Export Options</h2>
        </div>
        
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label htmlFor="status" className="block text-sm font-medium text-gray-700 mb-1">
              Member Status
            </label>
            <select
              id="status"
              value={exportOptions.status}
              onChange={(e) => setExportOptions({ ...exportOptions, status: e.target.value as any })}
              className="w-full rounded-md border-gray-300 shadow-sm focus:border-amber-500 focus:ring-amber-500"
            >
              <option value="">All Statuses</option>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
              <option value="suspended">Suspended</option>
            </select>
          </div>

          <div>
            <label htmlFor="tier" className="block text-sm font-medium text-gray-700 mb-1">
              Tier
            </label>
            <select
              id="tier"
              value={exportOptions.tier_id}
              onChange={(e) => setExportOptions({ ...exportOptions, tier_id: e.target.value })}
              className="w-full rounded-md border-gray-300 shadow-sm focus:border-amber-500 focus:ring-amber-500"
            >
              <option value="">All Tiers</option>
              {tiers.map(tier => (
                <option key={tier.id} value={tier.id}>{tier.name}</option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="format" className="block text-sm font-medium text-gray-700 mb-1">
              Export Format
            </label>
            <select
              id="format"
              value={exportOptions.format}
              onChange={(e) => setExportOptions({ ...exportOptions, format: e.target.value as any })}
              className="w-full rounded-md border-gray-300 shadow-sm focus:border-amber-500 focus:ring-amber-500"
            >
              <option value="csv">CSV (.csv)</option>
              <option value="json">JSON (.json)</option>
            </select>
          </div>
        </div>
      </div>

      {/* Data Preview */}
      <div className="bg-white shadow rounded-lg p-6 mb-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Data Preview</h2>
        
        <div className="mb-4">
          <p className="text-sm text-gray-600">
            Found <span className="font-semibold">{totalRecords}</span> members matching your criteria
          </p>
        </div>

        {preview.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Name
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Tier
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Points
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Events
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Status
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {preview.map((member, index) => (
                  <tr key={index}>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                      {member.name}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                      {member.tier}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                      {member.available_points}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                      {member.lifetime_events}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className={`inline-flex px-2 py-1 text-xs font-medium rounded-full ${
                        member.status === 'active' 
                          ? 'bg-green-100 text-green-800'
                          : member.status === 'inactive'
                          ? 'bg-gray-100 text-gray-800'
                          : 'bg-red-100 text-red-800'
                      }`}>
                        {member.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {totalRecords > 5 && (
              <p className="text-sm text-gray-500 text-center py-3">
                ...and {totalRecords - 5} more records
              </p>
            )}
          </div>
        ) : (
          <p className="text-center text-gray-500 py-8">
            No members found with the selected criteria
          </p>
        )}
      </div>

      {/* Export Fields Info */}
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-6">
        <h3 className="font-medium text-blue-900 mb-2">Exported Fields</h3>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-2 text-sm text-blue-800">
          <div className="flex items-center">
            <TableCellsIcon className="h-4 w-4 mr-1" />
            <span>Member ID</span>
          </div>
          <div className="flex items-center">
            <TableCellsIcon className="h-4 w-4 mr-1" />
            <span>Customer ID</span>
          </div>
          <div className="flex items-center">
            <TableCellsIcon className="h-4 w-4 mr-1" />
            <span>Name</span>
          </div>
          <div className="flex items-center">
            <TableCellsIcon className="h-4 w-4 mr-1" />
            <span>Email</span>
          </div>
          <div className="flex items-center">
            <TableCellsIcon className="h-4 w-4 mr-1" />
            <span>Phone Number</span>
          </div>
          <div className="flex items-center">
            <TableCellsIcon className="h-4 w-4 mr-1" />
            <span>Tier</span>
          </div>
          <div className="flex items-center">
            <TableCellsIcon className="h-4 w-4 mr-1" />
            <span>Status</span>
          </div>
          <div className="flex items-center">
            <TableCellsIcon className="h-4 w-4 mr-1" />
            <span>Available Points</span>
          </div>
          <div className="flex items-center">
            <TableCellsIcon className="h-4 w-4 mr-1" />
            <span>Lifetime Points</span>
          </div>
          <div className="flex items-center">
            <TableCellsIcon className="h-4 w-4 mr-1" />
            <span>Lifetime Events</span>
          </div>
          <div className="flex items-center">
            <TableCellsIcon className="h-4 w-4 mr-1" />
            <span>Join Date</span>
          </div>
          <div className="flex items-center">
            <TableCellsIcon className="h-4 w-4 mr-1" />
            <span>Last Activity</span>
          </div>
        </div>
      </div>

      {/* Export Button */}
      <div className="flex justify-end">
        <button
          onClick={handleExport}
          disabled={exporting || totalRecords === 0}
          className="inline-flex items-center px-6 py-3 border border-transparent rounded-md shadow-sm text-base font-medium text-white bg-amber-600 hover:bg-amber-700 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {exporting ? (
            <>
              <Loader2 className="h-5 w-5 animate-spin mr-2" />
              Exporting...
            </>
          ) : (
            <>
              {exportOptions.format === 'csv' ? (
                <DocumentTextIcon className="h-5 w-5 mr-2" />
              ) : (
                <TableCellsIcon className="h-5 w-5 mr-2" />
              )}
              Export {totalRecords} Members as {exportOptions.format.toUpperCase()}
            </>
          )}
        </button>
      </div>
    </div>
  );
}