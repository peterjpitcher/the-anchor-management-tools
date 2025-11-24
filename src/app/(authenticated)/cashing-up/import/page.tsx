'use client';

import { useState, useTransition } from 'react';
import { PageLayout } from '@/components/ui-v2/layout/PageLayout';
import Papa from 'papaparse';
import { importCashupHistoryAction, ImportRow } from '@/app/actions/cashing-up-import';

interface ImportResultState {
  total: number;
  succeeded: number;
  failed: number;
  errors: string[];
}

const DENOMINATIONS = [
  { value: 50, label: '£50' },
  { value: 20, label: '£20' },
  { value: 10, label: '£10' },
  { value: 5, label: '£5' },
  { value: 2, label: '£2' },
  { value: 1, label: '£1' },
  { value: 0.5, label: '50p' },
  { value: 0.2, label: '20p' },
  { value: 0.1, label: '10p' },
  { value: 0.05, label: '5p' },
  { value: 0.02, label: '2p' },
  { value: 0.01, label: '1p' },
];

export default function ImportPage() {
  const [file, setFile] = useState<File | null>(null);
  const [previewData, setPreviewData] = useState<ImportRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [result, setResult] = useState<ImportResultState | null>(null);
  const [progress, setProgress] = useState<{ processed: number, total: number } | null>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    setFile(selectedFile || null);
    setError(null);
    setResult(null);
    setProgress(null);
    setPreviewData([]);

    if (selectedFile) {
      parseFile(selectedFile);
    }
  };

  const parseFile = (file: File) => {
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        if (results.errors.length > 0) {
          setError('Error parsing CSV: ' + results.errors[0].message);
          return;
        }

        const rows: ImportRow[] = [];
        const data = results.data as any[];

        // Validate headers
        const firstRow = data[0];
        // Allow 'Cash' OR 'Actual Cash' for counted
        const hasCounted = 'Cash' in firstRow || 'Actual Cash' in firstRow;
        
        if (!firstRow || !('Date' in firstRow) || !hasCounted) {
          setError('Invalid CSV format. Missing required columns: Date, Cash (or Actual Cash), Card, Stripe');
          return;
        }

        for (let i = 0; i < data.length; i++) {
          const row = data[i];
          
          // Parse Denominations if present
          const cashCounts: Record<number, number> = {};
          let hasCounts = false;
          DENOMINATIONS.forEach(d => {
            // Try both label (e.g., "1p") and value keys if user customized
            if (row[d.label]) {
              const count = parseFloat(row[d.label]);
              if (!isNaN(count) && count > 0) {
                cashCounts[d.value] = count;
                hasCounts = true;
              }
            }
          });

          const counted = parseFloat(row['Cash'] || row['Actual Cash']) || 0;
          // Optional Expected/Z-Report
          const expectedRaw = row['Z Report Cash'] || row['Expected Cash'];
          const expected = expectedRaw !== undefined && expectedRaw !== '' ? parseFloat(expectedRaw) : undefined;

          rows.push({
            date: row['Date'],
            siteName: row['Site'] || '', 
            cashCounted: counted,
            cashExpected: expected,
            card: parseFloat(row['Card']) || 0,
            stripe: parseFloat(row['Stripe']) || 0,
            notes: row['Notes'] || '',
            cashCounts: hasCounts ? cashCounts : undefined
          });
        }

        setPreviewData(rows);
      },
      error: (err) => {
        setError('Failed to read file: ' + err.message);
      }
    });
  };

  const handleImport = () => {
    if (!previewData.length) return;

    startTransition(async () => {
      const BATCH_SIZE = 50;
      const total = previewData.length;
      let processed = 0;
      
      // Initialize result
      const currentResult: ImportResultState = {
        total: total,
        succeeded: 0,
        failed: 0,
        errors: []
      };

      setProgress({ processed: 0, total });
      
      for (let i = 0; i < total; i += BATCH_SIZE) {
        const batch = previewData.slice(i, i + BATCH_SIZE);
        
        try {
          const res = await importCashupHistoryAction(batch);
          
          if (res.success) {
            currentResult.succeeded += res.summary.succeeded;
            currentResult.failed += res.summary.failed;
            if (res.errors && res.errors.length > 0) {
              currentResult.errors.push(...res.errors);
            }
          } else {
             currentResult.failed += batch.length;
             currentResult.errors.push(`Batch failed: ${res.errors.join(', ')}`);
          }

          // Update state for intermediate feedback
          setResult({ ...currentResult });
          processed += batch.length;
          setProgress({ processed: Math.min(processed, total), total });

        } catch (err: any) {
          currentResult.failed += batch.length;
          currentResult.errors.push(`Batch processing error: ${err.message}`);
          setResult({ ...currentResult });
        }
      }
      
      // Finalize
      setProgress(null);
    });
  };

  const downloadTemplate = () => {
    const headers = ['Date', 'Actual Cash', 'Z Report Cash', 'Card', 'Stripe', 'Notes', ...DENOMINATIONS.map(d => d.label)];
    const example = [
      '2023-01-01', '500.00', '500.00', '1200.50', '300.00', 'Example Note',
      ...DENOMINATIONS.map(_ => '') // Empty cells for counts in example
    ];
    
    // Add one example count
    // Find index of '£1' for example (offset by fixed cols)
    const poundIndex = headers.indexOf('£1');
    if (poundIndex > -1) example[poundIndex] = '10'; // 10 x £1

    const csvContent = "data:text/csv;charset=utf-8," 
        + headers.join(",") + "\n" + example.join(",");
    
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", "cashing_up_import_template.csv");
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const navItems = [
    { label: 'Dashboard', href: '/cashing-up/dashboard' },
    { label: 'Daily Entry', href: '/cashing-up/daily' },
    { label: 'Weekly Breakdown', href: '/cashing-up/weekly' },
    { label: 'Insights', href: '/cashing-up/insights' },
    { label: 'Import History', href: '/cashing-up/import', active: true },
  ];

  return (
    <PageLayout title="Import Historic Cashing Up" navItems={navItems} containerSize="xl">
      <div className="space-y-6"> 
        
        {/* Instructions */}
        <div className="bg-white p-6 rounded-lg shadow border">
          <h3 className="text-lg font-semibold mb-4">Instructions</h3>
          <div className="prose text-sm text-gray-600 max-w-none">
            <p>Use this tool to import historic cashing up data. This is useful for migrating data from previous systems or spreadsheets.</p>
            <ul className="list-disc pl-5 space-y-1 mt-2">
              <li>The file must be a <strong>CSV</strong> (Comma Separated Values) file.</li>
              <li>Required columns: <strong>Date</strong> (YYYY-MM-DD), <strong>Actual Cash</strong>, <strong>Card</strong>, <strong>Stripe</strong>.</li>
              <li>Optional columns: <strong>Z Report Cash</strong> (Expected), <strong>Site</strong>, <strong>Notes</strong>, and denomination counts.</li>
              <li>If <strong>Z Report Cash</strong> is provided, it will be used to calculate variance. If omitted, variance will be £0.</li>
              <li>If denomination counts are provided, they will be saved.</li>
            </ul>
          </div>
          <div className="mt-6">
            <button 
              onClick={downloadTemplate}
              className="px-4 py-2 bg-blue-50 text-blue-600 rounded border border-blue-200 hover:bg-blue-100 text-sm font-medium flex items-center gap-2"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
              </svg>
              Download Template CSV
            </button>
          </div>
        </div>

        {/* Upload */}
        <div className="bg-white p-6 rounded-lg shadow border">
          <h3 className="text-lg font-semibold mb-4">Upload Data</h3>
          
          <div className="mb-6">
            <input 
              type="file" 
              accept=".csv"
              onChange={handleFileChange}
              className="block w-full text-sm text-gray-500
                file:mr-4 file:py-2 file:px-4
                file:rounded-full file:border-0
                file:text-sm file:font-semibold
                file:bg-blue-50 file:text-blue-700
                hover:file:bg-blue-100"
            />
          </div>

          {error && (
            <div className="p-4 bg-red-50 text-red-700 rounded border border-red-200 mb-4">
              {error}
            </div>
          )}

          {progress && (
            <div className="mb-4">
              <div className="flex justify-between text-sm font-medium mb-1 text-gray-700">
                <span>Importing...</span>
                <span>{Math.round((progress.processed / progress.total) * 100)}%</span>
              </div>
              <div className="w-full bg-gray-200 rounded-full h-2.5">
                <div 
                  className="bg-blue-600 h-2.5 rounded-full transition-all duration-300" 
                  style={{ width: `${(progress.processed / progress.total) * 100}%` }}
                ></div>
              </div>
              <p className="text-xs text-gray-500 mt-1 text-center">Processed {progress.processed} of {progress.total} rows</p>
            </div>
          )}

          {result && (
             <div className={`p-4 rounded border mb-4 ${result.failed === 0 ? 'bg-green-50 text-green-700 border-green-200' : 'bg-yellow-50 text-yellow-800 border-yellow-200'}`}>
               <h4 className="font-bold mb-2">{result.failed === 0 && !progress ? 'Import Successful!' : 'Import Status'}</h4>
               <p>Total Rows: {result.total}</p>
               <p>Succeeded: {result.succeeded}</p>
               <p>Failed: {result.failed}</p>
               {result.errors.length > 0 && (
                 <div className="mt-3 max-h-40 overflow-y-auto">
                   <p className="font-semibold text-xs uppercase mb-1">Errors:</p>
                   <ul className="list-disc pl-5 text-xs font-mono">
                     {result.errors.map((e, i) => <li key={i}>{e}</li>)}
                   </ul>
                 </div>
               )}
             </div>
          )}

          {previewData.length > 0 && !progress && (
            <div className="space-y-4">
              <div className="flex justify-between items-center">
                <h4 className="font-medium text-gray-700">Preview ({previewData.length} rows)</h4>
                <button 
                  onClick={handleImport}
                  disabled={isPending}
                  className="bg-blue-600 text-white px-6 py-2 rounded hover:bg-blue-700 disabled:opacity-50 font-medium"
                >
                  {isPending ? 'Starting Import...' : `Import ${previewData.length} Rows`}
                </button>
              </div>
              
              <div className="overflow-x-auto border rounded">
                <table className="min-w-full divide-y divide-gray-200 text-sm">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-4 py-2 text-left font-medium text-gray-500">Date</th>
                      <th className="px-4 py-2 text-left font-medium text-gray-500">Site</th>
                      <th className="px-4 py-2 text-right font-medium text-gray-500">Actual Cash</th>
                      <th className="px-4 py-2 text-right font-medium text-gray-500">Z Report Cash</th>
                      <th className="px-4 py-2 text-right font-medium text-gray-500">Card</th>
                      <th className="px-4 py-2 text-right font-medium text-gray-500">Stripe</th>
                      <th className="px-4 py-2 text-center font-medium text-gray-500">Has Counts?</th>
                      <th className="px-4 py-2 text-left font-medium text-gray-500">Notes</th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {previewData.slice(0, 10).map((row, i) => (
                      <tr key={i}>
                        <td className="px-4 py-2 whitespace-nowrap">{row.date}</td>
                        <td className="px-4 py-2 whitespace-nowrap">{row.siteName || '-'}</td>
                        <td className="px-4 py-2 text-right">£{row.cashCounted?.toFixed(2)}</td>
                        <td className="px-4 py-2 text-right">
                            {row.cashExpected !== undefined ? `£${row.cashExpected.toFixed(2)}` : <span className="text-gray-400 italic">Same as Actual</span>}
                        </td>
                        <td className="px-4 py-2 text-right">£{row.card.toFixed(2)}</td>
                        <td className="px-4 py-2 text-right">£{row.stripe.toFixed(2)}</td>
                        <td className="px-4 py-2 text-center">
                            {row.cashCounts ? (
                                <span className="text-green-600 text-xs bg-green-100 px-2 py-1 rounded">Yes</span>
                            ) : (
                                <span className="text-gray-400 text-xs">-</span>
                            )}
                        </td>
                        <td className="px-4 py-2 text-gray-500 truncate max-w-xs">{row.notes}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {previewData.length > 10 && (
                  <div className="px-4 py-2 text-xs text-gray-500 bg-gray-50 text-center">
                    ...and {previewData.length - 10} more rows
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </PageLayout>
  );
}