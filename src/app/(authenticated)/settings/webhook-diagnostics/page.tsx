'use client'

import { useState } from 'react'
import { diagnoseWebhookIssues } from '@/app/actions/diagnose-webhook-issues'
import { Page } from '@/components/ui-v2/layout/Page'
import { Section } from '@/components/ui-v2/layout/Section'
import { Card } from '@/components/ui-v2/layout/Card'
import { Button } from '@/components/ui-v2/forms/Button'
import { Alert } from '@/components/ui-v2/feedback/Alert'
import { Spinner } from '@/components/ui-v2/feedback/Spinner'

import { BackButton } from '@/components/ui-v2/navigation/BackButton';
import { useRouter } from 'next/navigation';
export default function WebhookDiagnosticsPage() {
  
  const router = useRouter();
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

  const breadcrumbs = [
    { label: 'Settings', href: '/settings' },
    { label: 'Webhook Diagnostics' }
  ]

  return (
    <Page
      title="Webhook Diagnostics"
      description="Check for common issues with Twilio webhook processing and message delivery"
      breadcrumbs={breadcrumbs}
    
      actions={<BackButton label="Back to Settings" onBack={() => router.push('/settings')} />}
    >
      <Section>
        <Card>
          <Alert
            variant="info"
            title="About this tool"
            
            className="mb-6"
          />

          <Button
            onClick={runDiagnostics}
            disabled={loading}
            loading={loading}
            variant="primary"
            size="md"
          >
            {loading ? 'Running diagnostics...' : 'Run Webhook Diagnostics'}
          </Button>

          {loading && (
            <div className="mt-6 flex justify-center">
              <Spinner size="lg" />
            </div>
          )}

          {report && !loading && (
            <div className="mt-6 space-y-4">
              {/* Errors */}
              {report.error && (
                <Alert variant="error"
                  title="Error"
                  description={report.error}
                />
              )}

              {/* Issues Found */}
              {report.issues && report.issues.length > 0 && (
                <Alert
                  variant="warning"
                  title="Issues Found"
                >
                  <ul className="list-disc list-inside space-y-1">
                    {report.issues.map((issue: string, index: number) => (
                      <li key={index}>{issue}</li>
                    ))}
                  </ul>
                
            This tool checks for common issues with Twilio webhook processing and message delivery.</Alert>
              )}

              {/* Recommendations */}
              {report.recommendations && report.recommendations.length > 0 && (
                <Alert
                  variant="info"
                  title="Recommendations"
                >
                  <ul className="list-disc list-inside space-y-1">
                    {report.recommendations.map((rec: string, index: number) => (
                      <li key={index}>{rec}</li>
                    ))}
                  </ul>
                </Alert>
              )}

              {/* Success */}
              {report.issues && report.issues.length === 0 && !report.error && (
                <Alert
                  variant="success"
                  title="All checks passed"
                  
                />
              )}

              {/* Migration Notice */}
              {report.issues && report.issues.some((issue: string) => issue.includes('missing columns')) && (
                <Alert
                  variant="warning"
                  title="Database Migration Required"
                >
                  <p>The webhook_logs table is missing required columns. Please run the following migration:</p>
                  <pre className="mt-2 bg-orange-100 p-2 rounded text-xs overflow-x-auto">
                    20250622_fix_webhook_logs_table.sql
                  </pre>
                
            No issues detected with webhook processing.</Alert>
              )}
            </div>
          )}
        </Card>
      </Section>
    </Page>
  )
}