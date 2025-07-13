'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { usePermissions } from '@/contexts/PermissionContext';
import Link from 'next/link';
import { 
  ArrowLeftIcon, 
  CloudArrowUpIcon, 
  DocumentTextIcon,
  ExclamationTriangleIcon,
  CheckCircleIcon,
  ArrowDownTrayIcon
} from '@heroicons/react/24/outline';
import toast from 'react-hot-toast';
import { bulkImportLoyaltyMembers } from '@/app/actions/loyalty-members';
import { Loader2 } from 'lucide-react';
import Papa from 'papaparse';

interface ImportRow {
  customer_id?: string;
  name?: string;
  phone_number?: string;
  email?: string;
  join_date?: string;
  lifetime_events?: number;
}

export default function BulkImportPage() {
  const router = useRouter();
  const { hasPermission } = usePermissions();
  const [file, setFile] = useState<File | null>(null);
  const [parsedData, setParsedData] = useState<ImportRow[]>([]);
  const [parseErrors, setParseErrors] = useState<string[]>([]);
  const [importing, setImporting] = useState(false);
  const [importResults, setImportResults] = useState<{
    imported: number;
    skipped: number;
    errors: string[];
  } | null>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (!selectedFile) return;

    setFile(selectedFile);
    setParsedData([]);
    setParseErrors([]);
    setImportResults(null);

    // Parse CSV file
    Papa.parse(selectedFile, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        const errors: string[] = [];
        const validRows: ImportRow[] = [];

        results.data.forEach((row: any, index: number) => {
          // Validate row
          if (!row.customer_id && (!row.name || !row.phone_number)) {
            errors.push(`Row ${index + 2}: Must have either customer_id OR both name and phone_number`);
            return;
          }

          // Clean up data
          const cleanRow: ImportRow = {
            customer_id: row.customer_id?.trim(),
            name: row.name?.trim(),
            phone_number: row.phone_number?.trim(),
            email: row.email?.trim(),
            join_date: row.join_date?.trim(),
            lifetime_events: row.lifetime_events ? parseInt(row.lifetime_events) : undefined
          };

          validRows.push(cleanRow);
        });

        if (results.errors.length > 0) {
          results.errors.forEach(error => {
            errors.push(`Parse error: ${error.message}`);
          });
        }

        setParsedData(validRows);
        setParseErrors(errors);
      },
      error: (error) => {
        toast.error(`Failed to parse CSV: ${error.message}`);
      }
    });
  };

  const handleImport = async () => {
    if (!parsedData.length) {
      toast.error('No valid data to import');
      return;
    }

    setImporting(true);
    setImportResults(null);

    try {
      const result = await bulkImportLoyaltyMembers(parsedData);

      if (result.error) {
        toast.error(result.error);
      } else if ('imported' in result) {
        setImportResults({
          imported: result.imported || 0,
          skipped: result.skipped || 0,
          errors: result.errors || []
        });

        if (result.imported && result.imported > 0) {
          toast.success(`Successfully imported ${result.imported} members`);
        }
      }
    } catch (error) {
      toast.error('Import failed');
    } finally {
      setImporting(false);
    }
  };

  const downloadTemplate = () => {
    const template = `customer_id,name,phone_number,email,join_date,lifetime_events
,John Smith,07700900000,john@example.com,2024-01-15,5
,Jane Doe,07700900001,jane@example.com,2024-02-20,12
,Bob Wilson,07700900002,,2024-03-10,`;

    const blob = new Blob([template], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'loyalty_import_template.csv';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.URL.revokeObjectURL(url);
  };

  if (!hasPermission('loyalty', 'manage')) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <p className="text-gray-500">You don&apos;t have permission to import members.</p>
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
        <h1 className="text-3xl font-bold text-gray-900 mt-4">Bulk Import Members</h1>
        <p className="mt-2 text-gray-600">
          Import multiple customers into the loyalty program via CSV file
        </p>
      </div>

      {/* Instructions */}
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-6">
        <h3 className="font-medium text-blue-900 mb-2">CSV Format Requirements</h3>
        <ul className="text-sm text-blue-800 space-y-1 list-disc list-inside">
          <li>First row must contain column headers</li>
          <li>Each row must have either <code className="bg-blue-100 px-1 rounded">customer_id</code> OR both <code className="bg-blue-100 px-1 rounded">name</code> and <code className="bg-blue-100 px-1 rounded">phone_number</code></li>
          <li>Optional columns: <code className="bg-blue-100 px-1 rounded">email</code>, <code className="bg-blue-100 px-1 rounded">join_date</code> (YYYY-MM-DD), <code className="bg-blue-100 px-1 rounded">lifetime_events</code></li>
          <li>Members are automatically assigned to the appropriate tier based on lifetime events</li>
          <li>All new members receive 50 welcome bonus points</li>
        </ul>
        <button
          onClick={downloadTemplate}
          className="mt-3 inline-flex items-center text-sm text-blue-700 hover:text-blue-900 font-medium"
        >
          <ArrowDownTrayIcon className="h-4 w-4 mr-1" />
          Download CSV Template
        </button>
      </div>

      {/* File Upload */}
      <div className="bg-white shadow rounded-lg p-6 mb-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Upload CSV File</h2>
        
        <div className="border-2 border-dashed border-gray-300 rounded-lg p-6 text-center">
          <CloudArrowUpIcon className="mx-auto h-12 w-12 text-gray-400 mb-3" />
          <label htmlFor="file-upload" className="cursor-pointer">
            <span className="text-sm font-medium text-amber-600 hover:text-amber-700">
              Choose a file
            </span>
            <span className="text-sm text-gray-500"> or drag and drop</span>
          </label>
          <input
            id="file-upload"
            name="file-upload"
            type="file"
            accept=".csv"
            className="sr-only"
            onChange={handleFileChange}
          />
          <p className="text-xs text-gray-500 mt-2">CSV files only</p>
          
          {file && (
            <div className="mt-4 inline-flex items-center text-sm text-gray-600">
              <DocumentTextIcon className="h-5 w-5 mr-2" />
              {file.name}
            </div>
          )}
        </div>
      </div>

      {/* Parse Results */}
      {parsedData.length > 0 && (
        <div className="bg-white shadow rounded-lg p-6 mb-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Preview</h2>
          
          <div className="mb-4">
            <p className="text-sm text-gray-600">
              Found <span className="font-semibold">{parsedData.length}</span> valid rows to import
            </p>
          </div>

          {parseErrors.length > 0 && (
            <div className="mb-4 bg-yellow-50 border border-yellow-200 rounded-lg p-4">
              <div className="flex">
                <ExclamationTriangleIcon className="h-5 w-5 text-yellow-600 mr-2 flex-shrink-0" />
                <div>
                  <h4 className="text-sm font-medium text-yellow-900">Parse Warnings</h4>
                  <ul className="mt-2 text-sm text-yellow-800 space-y-1">
                    {parseErrors.slice(0, 5).map((error, index) => (
                      <li key={index}>{error}</li>
                    ))}
                    {parseErrors.length > 5 && (
                      <li className="font-medium">...and {parseErrors.length - 5} more</li>
                    )}
                  </ul>
                </div>
              </div>
            </div>
          )}

          {/* Preview table */}
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Name
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Phone
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Email
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Events
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {parsedData.slice(0, 5).map((row, index) => (
                  <tr key={index}>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                      {row.name || <span className="text-gray-400">From customer ID</span>}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                      {row.phone_number || '-'}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                      {row.email || '-'}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                      {row.lifetime_events || 0}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {parsedData.length > 5 && (
              <p className="text-sm text-gray-500 text-center py-3">
                ...and {parsedData.length - 5} more rows
              </p>
            )}
          </div>

          <div className="mt-6 flex justify-end">
            <button
              onClick={handleImport}
              disabled={importing}
              className="inline-flex items-center px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-amber-600 hover:bg-amber-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {importing ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  Importing...
                </>
              ) : (
                <>
                  <CloudArrowUpIcon className="h-4 w-4 mr-2" />
                  Import {parsedData.length} Members
                </>
              )}
            </button>
          </div>
        </div>
      )}

      {/* Import Results */}
      {importResults && (
        <div className="bg-white shadow rounded-lg p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Import Results</h2>
          
          <div className="space-y-4">
            {importResults.imported > 0 && (
              <div className="flex items-center">
                <CheckCircleIcon className="h-5 w-5 text-green-600 mr-2" />
                <span className="text-sm">
                  Successfully imported <span className="font-semibold">{importResults.imported}</span> members
                </span>
              </div>
            )}
            
            {importResults.skipped > 0 && (
              <div className="flex items-center">
                <ExclamationTriangleIcon className="h-5 w-5 text-yellow-600 mr-2" />
                <span className="text-sm">
                  Skipped <span className="font-semibold">{importResults.skipped}</span> rows
                </span>
              </div>
            )}
            
            {importResults.errors.length > 0 && (
              <div className="bg-red-50 border border-red-200 rounded-lg p-4">
                <h4 className="text-sm font-medium text-red-900 mb-2">Import Errors</h4>
                <ul className="text-sm text-red-800 space-y-1">
                  {importResults.errors.slice(0, 10).map((error, index) => (
                    <li key={index}>{error}</li>
                  ))}
                  {importResults.errors.length > 10 && (
                    <li className="font-medium">...and {importResults.errors.length - 10} more</li>
                  )}
                </ul>
              </div>
            )}
          </div>

          <div className="mt-6 flex justify-end space-x-3">
            <button
              onClick={() => {
                setFile(null);
                setParsedData([]);
                setParseErrors([]);
                setImportResults(null);
              }}
              className="px-4 py-2 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50"
            >
              Import More
            </button>
            <Link
              href="/loyalty/admin"
              className="px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-amber-600 hover:bg-amber-700"
            >
              Done
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}