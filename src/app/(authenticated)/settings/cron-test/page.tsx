'use client'

import { useState } from 'react'
import { Page } from '@/components/ui-v2/layout/Page'
import { Section } from '@/components/ui-v2/layout/Section'
import { Card, CardTitle, CardDescription } from '@/components/ui-v2/layout/Card'
import { Button } from '@/components/ui-v2/forms/Button'
import { Alert } from '@/components/ui-v2/feedback/Alert'
import { Calendar, Bell, Play } from 'lucide-react'

import { BackButton } from '@/components/ui-v2/navigation/BackButton';
import { useRouter } from 'next/navigation';
export default function CronTestPage() {
  
  const router = useRouter();
const [loading, setLoading] = useState<string | null>(null)
  const [results, setResults] = useState<{ [key: string]: unknown }>({})

  async function runCronJob(jobName: string, endpoint: string) {
    setLoading(jobName)
    setResults(prev => ({ ...prev, [jobName]: null }))

    try {
      const response = await fetch(endpoint, {
        method: 'GET'
        // Auth is only required in production
      })
      
      const data = await response.json()
      setResults(prev => ({ ...prev, [jobName]: data }))
    } catch (error) {
      setResults(prev => ({ 
        ...prev, 
        [jobName]: { 
          error: 'Failed to run cron job', 
          details: error instanceof Error ? error.message : 'Unknown error' 
        } 
      }))
    } finally {
      setLoading(null)
    }
  }

  const cronJobs = [
    {
      name: 'recurring-invoices',
      title: 'Recurring Invoices',
      description: 'Process recurring invoices and generate new invoices for due dates',
      icon: Calendar,
      endpoint: '/api/cron/recurring-invoices'
    },
    {
      name: 'invoice-reminders',
      title: 'Invoice Reminders',
      description: 'Send reminders for overdue invoices',
      icon: Bell,
      endpoint: '/api/cron/invoice-reminders'
    }
  ]

  const breadcrumbs = [
    { label: 'Dashboard', href: '/' },
    { label: 'Settings', href: '/settings' },
    { label: 'Cron Job Testing' }
  ]

  return (
    <Page
      title="Cron Job Testing"
      breadcrumbs={breadcrumbs}
    
      actions={<BackButton label="Back to Settings" onBack={() => router.push('/settings')} />}
    >
      <Alert
        variant="warning"
        title="Development Only"
        
        className="mb-8"
      />

      <Section>
        <div className="space-y-6">
          {cronJobs.map((job) => {
            const Icon = job.icon
            const result = results[job.name]
            const isLoading = loading === job.name
            const hasError = result && typeof result === 'object' && 'error' in result

            return (
              <Card key={job.name}>
                <div className="flex items-start justify-between">
                  <div className="flex items-start gap-4">
                    <div className="p-3 bg-gray-100 rounded-lg">
                      <Icon className="h-6 w-6 text-gray-600" />
                    </div>
                    <div>
                      <CardTitle>{job.title}</CardTitle>
                      <CardDescription>{job.description}</CardDescription>
                    </div>
                  </div>
                  <Button
                    onClick={() => runCronJob(job.name, job.endpoint)}
                    loading={isLoading}
                    leftIcon={!isLoading ? <Play /> : undefined}
                  >
                    {isLoading ? 'Running...' : 'Run Now'}
                  </Button>
                </div>

                {result !== null && result !== undefined && (
                  <div className="mt-4">
                    {hasError ? (
                      <Alert variant="error"
                        title="Error"
                        description={(result as any).error}
                      >
                        {(result as any).details && (
                          <p className="mt-1 text-xs">{(result as any).details}</p>
                        )}
                      
            This page allows manual triggering of cron jobs for testing purposes. In production, these jobs run automatically according to their schedules.</Alert>
                    ) : (
                      <div className="p-4 bg-gray-50 rounded-lg">
                        <h3 className="font-medium mb-2">Results:</h3>
                        <pre className="text-sm overflow-x-auto">
                          {(() => {
                            try {
                              return JSON.stringify(result, null, 2)
                            } catch {
                              return String(result)
                            }
                          })()}
                        </pre>
                      </div>
                    )}
                  </div>
                )}
              </Card>
            )
          })}
        </div>
      </Section>

      <Section 
        title="Cron Job Schedules"
        className="mt-8"
        variant="gray"
      >
        <div className="space-y-2 text-sm">
          <div className="flex justify-between">
            <span className="font-medium">Recurring Invoices:</span>
            <span className="text-gray-600">Daily at 8:00 AM UTC</span>
          </div>
          <div className="flex justify-between">
            <span className="font-medium">Invoice Reminders:</span>
            <span className="text-gray-600">Daily at 10:00 AM UTC</span>
          </div>
        </div>
        <p className="text-xs text-gray-500 mt-4">
          Note: These times are in UTC. Adjust for your local timezone.
        </p>
      </Section>
    </Page>
  )
}