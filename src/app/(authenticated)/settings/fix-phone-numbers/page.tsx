'use client'

import { useState } from 'react'
import { analyzePhoneNumbers, fixPhoneNumbers } from '@/app/actions/fix-phone-numbers'
import { Page } from '@/components/ui-v2/layout/Page'
import { Section } from '@/components/ui-v2/layout/Section'
import { Card } from '@/components/ui-v2/layout/Card'
import { Button } from '@/components/ui-v2/forms/Button'
import { Alert } from '@/components/ui-v2/feedback/Alert'
import { Spinner } from '@/components/ui-v2/feedback/Spinner'
import { DataTable, Column } from '@/components/ui-v2/display/DataTable'
import { ExclamationTriangleIcon, CheckCircleIcon, InformationCircleIcon } from '@heroicons/react/24/outline'

import { BackButton } from '@/components/ui-v2/navigation/BackButton';
import { useRouter } from 'next/navigation';
export default function FixPhoneNumbersPage() {
  
  const router = useRouter();
const [loading, setLoading] = useState(false)
  const [analysis, setAnalysis] = useState<any>(null)
  const [fixResult, setFixResult] = useState<any>(null)

  const runAnalysis = async () => {
    setLoading(true)
    setFixResult(null)
    try {
      const result = await analyzePhoneNumbers()
      setAnalysis(result)
    } catch (error) {
      console.error('Analysis failed:', error)
      setAnalysis({ error: 'Failed to analyze phone numbers' })
    } finally {
      setLoading(false)
    }
  }

  const runFix = async (dryRun: boolean) => {
    setLoading(true)
    try {
      const result = await fixPhoneNumbers(dryRun)
      setFixResult(result)
    } catch (error) {
      console.error('Fix failed:', error)
      setFixResult({ error: 'Failed to fix phone numbers' })
    } finally {
      setLoading(false)
    }
  }

  const breadcrumbs = [
    { label: 'Settings', href: '/settings' },
    { label: 'Phone Number Standardization' }
  ]

  return (
    <Page
      title="Phone Number Standardization"
      breadcrumbs={breadcrumbs}
      loading={loading && !analysis && !fixResult}
    
      actions={<BackButton label="Back to Settings" onBack={() => router.push('/settings')} />}
    >
      <div className="space-y-6">
        <Section>
          <Alert
            variant="info"
            title="About this tool"
            
          />

          <div className="space-x-4 mt-6">
            <Button
              onClick={runAnalysis}
              disabled={loading}
              loading={loading && !fixResult}
            >
              Analyze Phone Numbers
            </Button>
            
            {analysis && !analysis.error && (
              <>
                <Button
                  onClick={() => runFix(true)}
                  disabled={loading}
                  variant="secondary"
                  loading={loading && fixResult?.dryRun}
                >
                  Dry Run Fix
                </Button>
                
                <Button
                  onClick={() => runFix(false)}
                  disabled={loading}
                  variant="primary"
                  loading={loading && fixResult && !fixResult.dryRun}
                >
                  Apply Fixes
                </Button>
              </>
            )}
          </div>

          {/* Analysis Results */}
          {analysis && !analysis.error && (
            <Card variant="bordered" className="mt-6">
              <h2 className="text-lg font-semibold mb-3">Analysis Results</h2>
              <div className="bg-gray-50 rounded-lg p-4">
                <dl className="grid grid-cols-1 gap-x-4 gap-y-4 sm:grid-cols-2">
                  <div>
                    <dt className="text-sm font-medium text-gray-500">Total phone numbers</dt>
                    <dd className="mt-1 text-2xl font-semibold text-gray-900">{analysis.total}</dd>
                  </div>
                  <div>
                    <dt className="text-sm font-medium text-gray-500">Already standardized (+44...)</dt>
                    <dd className="mt-1 text-2xl font-semibold text-green-600">{analysis.e164Format}</dd>
                  </div>
                  <div>
                    <dt className="text-sm font-medium text-gray-500">UK numbers with 0</dt>
                    <dd className="mt-1 text-2xl font-semibold text-yellow-600">{analysis.ukWithZero}</dd>
                  </div>
                  <div>
                    <dt className="text-sm font-medium text-gray-500">Missing + prefix</dt>
                    <dd className="mt-1 text-2xl font-semibold text-yellow-600">{analysis.ukWithoutPlus}</dd>
                  </div>
                  <div>
                    <dt className="text-sm font-medium text-gray-500">Non-standard format</dt>
                    <dd className="mt-1 text-2xl font-semibold text-orange-600">{analysis.nonStandard}</dd>
                  </div>
                  <div>
                    <dt className="text-sm font-medium text-gray-500">Invalid/Unfixable</dt>
                    <dd className="mt-1 text-2xl font-semibold text-red-600">{analysis.invalid}</dd>
                  </div>
                </dl>
              </div>

              {analysis.samples?.needsFixing?.length > 0 && (
                <div className="mt-4">
                  <h3 className="text-sm font-medium text-gray-700 mb-2">Sample phone numbers needing fixes:</h3>
                  <DataTable
                    data={analysis.samples.needsFixing.slice(0, 5)}
                    columns={[
                      {
                        key: 'current',
                        header: 'Current',
                        cell: (row) => <span className="font-mono">{row.current}</span>
                      },
                      {
                        key: 'suggested',
                        header: 'Suggested Fix',
                        cell: (row) => row.suggested ? (
                          <span className="font-mono">{row.suggested}</span>
                        ) : (
                          <span className="text-red-600">Cannot fix</span>
                        )
                      }
                    ] as Column[]}
                    getRowKey={(row) => analysis.samples.needsFixing.indexOf(row)}
                    size="sm"
                  />
                </div>
              )}
            </Card>
          )}

          {/* Fix Results */}
          {fixResult && !fixResult.error && (
            <Card variant="bordered" className="mt-6">
              <h2 className="text-lg font-semibold mb-3">
                {fixResult.dryRun ? 'Dry Run Results' : 'Fix Applied'}
              </h2>
              
              {fixResult.toUpdate?.length > 0 && (
                <Alert
                  variant="success"
                  title={`${fixResult.dryRun ? 'Would update' : 'Updated'} ${fixResult.toUpdate.length} phone numbers`}
                  className="mb-4"
                >
                  <details className="cursor-pointer mt-2">
                    <summary className="text-sm font-medium">View details</summary>
                    <div className="mt-2 max-h-60 overflow-y-auto">
                      <DataTable
                        data={fixResult.toUpdate}
                        columns={[
                          {
                            key: 'name',
                            header: 'Customer',
                            cell: (row) => row.name
                          },
                          {
                            key: 'current',
                            header: 'From',
                            cell: (row) => <span className="font-mono">{row.current}</span>
                          },
                          {
                            key: 'standardized',
                            header: 'To',
                            cell: (row) => <span className="font-mono">{row.standardized}</span>
                          }
                        ] as Column[]}
                        getRowKey={(row) => fixResult.toUpdate.indexOf(row)}
                        size="sm"
                      />
                    </div>
                  </details>
                
            This tool analyzes and standardizes phone numbers to E.164 format (+44...) for better compatibility with SMS services.</Alert>
              )}

              {fixResult.unfixable?.length > 0 && (
                <Alert
                  variant="error"
                  title={`${fixResult.unfixable.length} phone numbers cannot be fixed automatically`}
                >
                  <p>These require manual review:</p>
                  <ul className="mt-1 list-disc list-inside">
                    {fixResult.unfixable.slice(0, 5).map((item: any, idx: number) => (
                      <li key={idx}>
                        {item.name}: {item.current} ({item.reason})
                      </li>
                    ))}
                    {fixResult.unfixable.length > 5 && (
                      <li>...and {fixResult.unfixable.length - 5} more</li>
                    )}
                  </ul>
                </Alert>
              )}
            </Card>
          )}

          {/* Errors */}
          {(analysis?.error || fixResult?.error) && (
            <Alert variant="error"
              title="Error"
              description={analysis?.error || fixResult?.error}
              className="mt-6"
            />
          )}
        </Section>
      </div>
    </Page>
  )
}