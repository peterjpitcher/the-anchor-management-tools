'use client'

import { useState } from 'react'
import { analyzePhoneNumbers, fixPhoneNumbers } from '@/app/actions/fix-phone-numbers'
import { Button } from '@/components/ui/Button'
import { ExclamationTriangleIcon, CheckCircleIcon, InformationCircleIcon } from '@heroicons/react/24/outline'

export default function FixPhoneNumbersPage() {
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

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 px-4 sm:px-6 lg:px-8">
      <div className="bg-white shadow rounded-lg">
        <div className="px-4 py-5 sm:p-6">
          <h1 className="text-2xl font-bold text-gray-900 mb-4">Phone Number Standardization</h1>
          
          <div className="bg-blue-50 border border-blue-200 rounded-md p-4 mb-6">
            <div className="flex">
              <div className="flex-shrink-0">
                <InformationCircleIcon className="h-5 w-5 text-blue-400" />
              </div>
              <div className="ml-3">
                <h3 className="text-sm font-medium text-blue-800">About this tool</h3>
                <div className="mt-2 text-sm text-blue-700">
                  <p>This tool analyzes and standardizes phone numbers to E.164 format (+44...) for better compatibility with SMS services.</p>
                </div>
              </div>
            </div>
          </div>

          <div className="space-x-4 mb-6">
            <Button
              onClick={runAnalysis}
              disabled={loading}
            >
              {loading && !fixResult ? 'Analyzing...' : 'Analyze Phone Numbers'}
            </Button>
            
            {analysis && !analysis.error && (
              <>
                <Button
                  onClick={() => runFix(true)}
                  disabled={loading}
                  variant="secondary"
                >
                  {loading && fixResult?.dryRun ? 'Running dry run...' : 'Dry Run Fix'}
                </Button>
                
                <Button
                  onClick={() => runFix(false)}
                  disabled={loading}
                  variant="primary"
                  className="bg-orange-600 hover:bg-orange-700"
                >
                  {loading && fixResult && !fixResult.dryRun ? 'Applying fixes...' : 'Apply Fixes'}
                </Button>
              </>
            )}
          </div>

          {/* Analysis Results */}
          {analysis && !analysis.error && (
            <div className="mb-6">
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
                  <div className="bg-white border border-gray-200 rounded-md overflow-hidden">
                    <table className="min-w-full divide-y divide-gray-200">
                      <thead className="bg-gray-50">
                        <tr>
                          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                            Current
                          </th>
                          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                            Suggested Fix
                          </th>
                        </tr>
                      </thead>
                      <tbody className="bg-white divide-y divide-gray-200">
                        {analysis.samples.needsFixing.slice(0, 5).map((sample: any, index: number) => (
                          <tr key={index}>
                            <td className="px-6 py-4 whitespace-nowrap text-sm font-mono text-gray-900">
                              {sample.current}
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm font-mono text-gray-900">
                              {sample.suggested || <span className="text-red-600">Cannot fix</span>}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Fix Results */}
          {fixResult && !fixResult.error && (
            <div className="mt-6">
              <h2 className="text-lg font-semibold mb-3">
                {fixResult.dryRun ? 'Dry Run Results' : 'Fix Applied'}
              </h2>
              
              {fixResult.toUpdate?.length > 0 && (
                <div className="mb-4">
                  <div className="bg-green-50 border border-green-200 rounded-md p-4">
                    <div className="flex">
                      <div className="flex-shrink-0">
                        <CheckCircleIcon className="h-5 w-5 text-green-400" />
                      </div>
                      <div className="ml-3">
                        <h3 className="text-sm font-medium text-green-800">
                          {fixResult.dryRun ? 'Would update' : 'Updated'} {fixResult.toUpdate.length} phone numbers
                        </h3>
                        <div className="mt-2 text-sm text-green-700">
                          <details className="cursor-pointer">
                            <summary>View details</summary>
                            <div className="mt-2 max-h-60 overflow-y-auto">
                              <table className="min-w-full text-xs">
                                <thead>
                                  <tr>
                                    <th className="text-left pr-4">Customer</th>
                                    <th className="text-left pr-4">From</th>
                                    <th className="text-left">To</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {fixResult.toUpdate.map((update: any, idx: number) => (
                                    <tr key={idx}>
                                      <td className="pr-4">{update.name}</td>
                                      <td className="pr-4 font-mono">{update.current}</td>
                                      <td className="font-mono">{update.standardized}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          </details>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {fixResult.unfixable?.length > 0 && (
                <div className="bg-red-50 border border-red-200 rounded-md p-4">
                  <div className="flex">
                    <div className="flex-shrink-0">
                      <ExclamationTriangleIcon className="h-5 w-5 text-red-400" />
                    </div>
                    <div className="ml-3">
                      <h3 className="text-sm font-medium text-red-800">
                        {fixResult.unfixable.length} phone numbers cannot be fixed automatically
                      </h3>
                      <div className="mt-2 text-sm text-red-700">
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
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Errors */}
          {(analysis?.error || fixResult?.error) && (
            <div className="bg-red-50 border border-red-200 rounded-md p-4">
              <div className="flex">
                <div className="flex-shrink-0">
                  <ExclamationTriangleIcon className="h-5 w-5 text-red-400" />
                </div>
                <div className="ml-3">
                  <h3 className="text-sm font-medium text-red-800">Error</h3>
                  <div className="mt-2 text-sm text-red-700">
                    <p>{analysis?.error || fixResult?.error}</p>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}