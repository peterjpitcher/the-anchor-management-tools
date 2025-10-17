'use client'

import { useState, useTransition } from 'react'
import { diagnoseWebhookIssues } from '@/app/actions/diagnose-webhook-issues'
import { Page } from '@/components/ui-v2/layout/Page'
import { Section } from '@/components/ui-v2/layout/Section'
import { Card } from '@/components/ui-v2/layout/Card'
import { Button } from '@/components/ui-v2/forms/Button'
import { Alert } from '@/components/ui-v2/feedback/Alert'
import { Spinner } from '@/components/ui-v2/feedback/Spinner'
import { BackButton } from '@/components/ui-v2/navigation/BackButton'
import { useRouter } from 'next/navigation'

type DiagnosticsReport = {
  timestamp?: string
  issues?: string[]
  recommendations?: string[]
  error?: string
}

type WebhookDiagnosticsClientProps = {
  initialReport: DiagnosticsReport | null
  initialError: string | null
}

export default function WebhookDiagnosticsClient({ initialReport, initialError }: WebhookDiagnosticsClientProps) {
  const router = useRouter()
  const [report, setReport] = useState<DiagnosticsReport | null>(initialReport)
  const [error, setError] = useState<string | null>(initialError)
  const [isRunning, startTransition] = useTransition()

  const breadcrumbs = [
    { label: 'Settings', href: '/settings' },
    { label: 'Webhook Diagnostics' },
  ]

  const runDiagnostics = () => {
    startTransition(async () => {
      setError(null)
      const result = await diagnoseWebhookIssues()
      if (result.error) {
        setError(result.error)
      }
      setReport(result)
    })
  }

  return (
    <Page
      title="Webhook Diagnostics"
      description="Check for common issues with Twilio webhook processing and message delivery."
      breadcrumbs={breadcrumbs}
      actions={<BackButton label="Back to Settings" onBack={() => router.push('/settings')} />}
    >
      <Section>
        <Card>
          <Alert
            variant="info"
            title="About this tool"
            description="Runs a series of automated checks against webhook logs, recent messages, customer data, and environment configuration to flag common Twilio integration issues."
            className="mb-6"
          />

          {error && (
            <Alert
              variant="error"
              title="Unable to run diagnostics"
              description={error}
              className="mb-4"
            />
          )}

          <Button onClick={runDiagnostics} disabled={isRunning} loading={isRunning}>
            {isRunning ? 'Running diagnostics…' : 'Run Webhook Diagnostics'}
          </Button>

          {isRunning && (
            <div className="mt-6 flex justify-center">
              <Spinner size="lg" />
            </div>
          )}

          {report && !isRunning && (
            <div className="mt-6 space-y-4">
              {report.error && (
                <Alert variant="error" title="Diagnostic Error" description={report.error} />
              )}

              {report.issues && report.issues.length > 0 && (
                <Alert
                  variant="warning"
                  title={`Issues Found (${report.issues.length})`}
                >
                  <ul className="list-disc list-inside space-y-1 text-sm">
                    {report.issues.map((issue, index) => (
                      <li key={index}>{issue}</li>
                    ))}
                  </ul>
                </Alert>
              )}

              {report.recommendations && report.recommendations.length > 0 && (
                <Alert variant="info" title="Recommendations">
                  <ul className="list-disc list-inside space-y-1 text-sm">
                    {report.recommendations.map((rec, index) => (
                      <li key={index}>{rec}</li>
                    ))}
                  </ul>
                </Alert>
              )}

              {report.issues && report.issues.length === 0 && !report.error && (
                <Alert
                  variant="success"
                  title="All checks passed"
                  description="No issues detected with webhook processing."
                />
              )}

              {report.timestamp && (
                <p className="text-xs text-gray-500">
                  Last run: {new Date(report.timestamp).toLocaleString()}
                </p>
              )}
            </div>
          )}
        </Card>
      </Section>
    </Page>
  )
}
