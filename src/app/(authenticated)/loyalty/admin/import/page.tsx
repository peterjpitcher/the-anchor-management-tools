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
import { bulkImportLoyaltyMembers } from '@/app/actions/loyalty-members';
import { Loader2 } from 'lucide-react';
import Papa from 'papaparse';
import { Page } from '@/components/ui-v2/layout/Page';
import { Card, CardHeader, CardTitle, CardDescription } from '@/components/ui-v2/layout/Card';
import { Section } from '@/components/ui-v2/layout/Section';
import { Alert } from '@/components/ui-v2/feedback/Alert';
import { Button } from '@/components/ui-v2/forms/Button';
import { LinkButton } from '@/components/ui-v2/navigation/LinkButton';
import { FileUpload } from '@/components/ui-v2/forms/FileUpload';
import { DataTable } from '@/components/ui-v2/display/DataTable';
import { Badge } from '@/components/ui-v2/display/Badge';
import { toast } from '@/components/ui-v2/feedback/Toast';
import { Spinner } from '@/components/ui-v2/feedback/Spinner';

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

  const handleFileChange = (files: File[]) => {
    const selectedFile = files[0];
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
      <Page title="Bulk Import Members" error="You don't have permission to import members." />
    );
  }

  return (
    <Page
      title="Bulk Import Members"
      description="Import multiple customers into the loyalty program via CSV file"
      breadcrumbs={[
        { label: 'Loyalty Admin', href: '/loyalty/admin' },
        { label: 'Bulk Import' }
      ]}
    >
      {/* Instructions */}
      <Alert
        variant="info"
        title="CSV Format Requirements"
        className="mb-6"
      >
        <div>
          <ul className="text-sm space-y-1 list-disc list-inside">
            <li>First row must contain column headers</li>
            <li>Each row must have either <code className="bg-blue-100 px-1 rounded">customer_id</code> OR both <code className="bg-blue-100 px-1 rounded">name</code> and <code className="bg-blue-100 px-1 rounded">phone_number</code></li>
            <li>Optional columns: <code className="bg-blue-100 px-1 rounded">email</code>, <code className="bg-blue-100 px-1 rounded">join_date</code> (YYYY-MM-DD), <code className="bg-blue-100 px-1 rounded">lifetime_events</code></li>
            <li>Members are automatically assigned to the appropriate tier based on lifetime events</li>
            <li>All new members receive 50 welcome bonus points</li>
          </ul>
          <Button size="sm"
            variant="link"
            onClick={downloadTemplate}
            leftIcon={<ArrowDownTrayIcon className="h-4 w-4" />}
            className="mt-3"
          >
            Download CSV Template
          </Button>
        </div>
      </Alert>

      {/* File Upload */}
      <Card className="mb-6">
        <CardHeader>
          <CardTitle>Upload CSV File</CardTitle>
        </CardHeader>
        
        <FileUpload
          accept=".csv"
          onFilesChange={handleFileChange}
          files={file ? [file] : []}
          maxFiles={1}
          uploadDescription="CSV files only"
        />
      </Card>

      {/* Parse Results */}
      {parsedData.length > 0 && (
        <Card className="mb-6">
          <CardHeader>
            <CardTitle>Preview</CardTitle>
            <CardDescription>
              Found <span className="font-semibold">{parsedData.length}</span> valid rows to import
            </CardDescription>
          </CardHeader>
          
          {parseErrors.length > 0 && (
            <Alert
              variant="warning"
              title="Parse Warnings"
              className="mb-4"
            >
              <ul className="mt-2 text-sm space-y-1">
                {parseErrors.slice(0, 5).map((error, index) => (
                  <li key={index}>{error}</li>
                ))}
                {parseErrors.length > 5 && (
                  <li className="font-medium">...and {parseErrors.length - 5} more</li>
                )}
              </ul>
            </Alert>
          )}

          {/* Preview table */}
          <div className="mb-6">
            <DataTable
              data={parsedData.slice(0, 5)}
              getRowKey={(row) => row.phone_number || row.customer_id || Math.random().toString()}
              columns={[
                { 
                  key: 'name',
                  header: 'Name', 
                  cell: (row) => row.name || <span className="text-gray-400">From customer ID</span>
                },
                { 
                  key: 'phone',
                  header: 'Phone', 
                  cell: (row) => row.phone_number || '-'
                },
                { 
                  key: 'email',
                  header: 'Email', 
                  cell: (row) => row.email || '-'
                },
                { 
                  key: 'events',
                  header: 'Events', 
                  cell: (row) => row.lifetime_events || 0
                }
              ]}
            />
            {parsedData.length > 5 && (
              <p className="text-sm text-gray-500 text-center py-3">
                ...and {parsedData.length - 5} more rows
              </p>
            )}
          </div>

          <div className="flex justify-end">
            <Button onClick={handleImport}
              loading={importing}
              leftIcon={<CloudArrowUpIcon className="h-4 w-4" />}
            >
              Import {parsedData.length} Members
            </Button>
          </div>
        </Card>
      )}

      {/* Import Results */}
      {importResults && (
        <Card>
          <CardHeader>
            <CardTitle>Import Results</CardTitle>
          </CardHeader>
          
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
              <Alert
                variant="error"
                title="Import Errors"
              >
                <ul className="mt-2 text-sm space-y-1">
                  {importResults.errors.slice(0, 10).map((error, index) => (
                    <li key={index}>{error}</li>
                  ))}
                  {importResults.errors.length > 10 && (
                    <li className="font-medium">...and {importResults.errors.length - 10} more</li>
                  )}
                </ul>
              </Alert>
            )}
          </div>

          <div className="mt-6 flex justify-end gap-3">
            <Button
              variant="secondary"
              onClick={() => {
                setFile(null);
                setParsedData([]);
                setParseErrors([]);
                setImportResults(null);
              }}
            >
              Import More
            </Button>
            <LinkButton href="/loyalty/admin">
              Done
            </LinkButton>
          </div>
        </Card>
      )}
    </Page>
  );
}