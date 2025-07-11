'use client'

import { useState } from 'react'
import { diagnoseWebhookIssues } from '@/app/actions/diagnose-webhook-issues'
import { Button } from '@/components/ui/Button'
import { ExclamationTriangleIcon, CheckCircleIcon, InformationCircleIcon } from '@heroicons/react/24/outline'

export default function WebhookDiagnosticsPage() {
  const [loading, setLoading] = useState(false)
  const [report, setReport] = useState<any>(null)

  const runDiagnostics = async () => {
    setLoading(true)
    try {
      const result = await diagnoseWebhookIssues()
      setReport(result)
    } catch (error) {
      console.error('Diagnostic failed:', error)
      setReport({ error: 'Failed to run diagnostics' })
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="bg-white shadow rounded-lg">
      <div className="px-4 py-5 sm:p-6">
        <h1 className="text-2xl font-bold text-gray-900 mb-4">Webhook Diagnostics</h1>
          
          <div className="bg-blue-50 border border-blue-200 rounded-md p-4 mb-6">
            <div className="flex">
              <div className="flex-shrink-0">
                <InformationCircleIcon className="h-5 w-5 text-blue-400" />
              </div>
              <div className="ml-3">
                <h3 className="text-sm font-medium text-blue-800">About this tool</h3>
                <div className="mt-2 text-sm text-blue-700">
                  <p>This tool checks for common issues with Twilio webhook processing and message delivery.</p>
                </div>
              </div>
            </div>
          </div>

          <Button
            onClick={runDiagnostics}
            disabled={loading}
            className="mb-6"
          >
            {loading ? 'Running diagnostics...' : 'Run Webhook Diagnostics'}
          </Button>

          {report && (
            <div className="space-y-6">
              {/* Errors */}
              {report.error && (
                <div className="bg-red-50 border border-red-200 rounded-md p-4">
                  <div className="flex">
                    <div className="flex-shrink-0">
                      <ExclamationTriangleIcon className="h-5 w-5 text-red-400" />
                    </div>
                    <div className="ml-3">
                      <h3 className="text-sm font-medium text-red-800">Error</h3>
                      <div className="mt-2 text-sm text-red-700">
                        <p>{report.error}</p>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Issues Found */}
              {report.issues && report.issues.length > 0 && (
                <div className="bg-yellow-50 border border-yellow-200 rounded-md p-4">
                  <div className="flex">
                    <div className="flex-shrink-0">
                      <ExclamationTriangleIcon className="h-5 w-5 text-yellow-400" />
                    </div>
                    <div className="ml-3">
                      <h3 className="text-sm font-medium text-yellow-800">Issues Found</h3>
                      <div className="mt-2 text-sm text-yellow-700">
                        <ul className="list-disc list-inside space-y-1">
                          {report.issues.map((issue: string, index: number) => (
                            <li key={index}>{issue}</li>
                          ))}
                        </ul>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Recommendations */}
              {report.recommendations && report.recommendations.length > 0 && (
                <div className="bg-blue-50 border border-blue-200 rounded-md p-4">
                  <div className="flex">
                    <div className="flex-shrink-0">
                      <InformationCircleIcon className="h-5 w-5 text-blue-400" />
                    </div>
                    <div className="ml-3">
                      <h3 className="text-sm font-medium text-blue-800">Recommendations</h3>
                      <div className="mt-2 text-sm text-blue-700">
                        <ul className="list-disc list-inside space-y-1">
                          {report.recommendations.map((rec: string, index: number) => (
                            <li key={index}>{rec}</li>
                          ))}
                        </ul>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Success */}
              {report.issues && report.issues.length === 0 && !report.error && (
                <div className="bg-green-50 border border-green-200 rounded-md p-4">
                  <div className="flex">
                    <div className="flex-shrink-0">
                      <CheckCircleIcon className="h-5 w-5 text-green-400" />
                    </div>
                    <div className="ml-3">
                      <h3 className="text-sm font-medium text-green-800">All checks passed</h3>
                      <div className="mt-2 text-sm text-green-700">
                        <p>No issues detected with webhook processing.</p>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Migration Notice */}
              {report.issues && report.issues.some((issue: string) => issue.includes('missing columns')) && (
                <div className="bg-orange-50 border border-orange-200 rounded-md p-4">
                  <div className="flex">
                    <div className="flex-shrink-0">
                      <ExclamationTriangleIcon className="h-5 w-5 text-orange-400" />
                    </div>
                    <div className="ml-3">
                      <h3 className="text-sm font-medium text-orange-800">Database Migration Required</h3>
                      <div className="mt-2 text-sm text-orange-700">
                        <p>The webhook_logs table is missing required columns. Please run the following migration:</p>
                        <pre className="mt-2 bg-orange-100 p-2 rounded text-xs overflow-x-auto">
                          20250622_fix_webhook_logs_table.sql
                        </pre>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
      </div>
    </div>
  )
}