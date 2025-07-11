'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Calendar, Bell, Play, Loader2 } from 'lucide-react'

export default function CronTestPage() {
  const [loading, setLoading] = useState<string | null>(null)
  const [results, setResults] = useState<{ [key: string]: unknown }>({})

  async function runCronJob(jobName: string, endpoint: string) {
    setLoading(jobName)
    setResults(prev => ({ ...prev, [jobName]: null }))

    try {
      const response = await fetch(endpoint, {
        headers: {
          // In dev, the cron endpoint won't check auth
          'Authorization': `Bearer ${process.env.CRON_SECRET || 'dev'}`
        }
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

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
      <h1 className="text-3xl font-bold mb-8">Cron Job Testing</h1>
      
      <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 mb-8">
        <p className="text-sm text-yellow-800">
          <strong>Development Only:</strong> This page allows manual triggering of cron jobs for testing purposes.
          In production, these jobs run automatically according to their schedules.
        </p>
      </div>

      <div className="space-y-6">
        {cronJobs.map((job) => {
          const Icon = job.icon
          const result = results[job.name]
          const isLoading = loading === job.name

          return (
            <div key={job.name} className="bg-white rounded-lg shadow-sm border p-6">
              <div className="flex items-start justify-between">
                <div className="flex items-start gap-4">
                  <div className="p-3 bg-gray-100 rounded-lg">
                    <Icon className="h-6 w-6 text-gray-600" />
                  </div>
                  <div>
                    <h2 className="text-xl font-semibold mb-1">{job.title}</h2>
                    <p className="text-gray-600">{job.description}</p>
                  </div>
                </div>
                <Button
                  onClick={() => runCronJob(job.name, job.endpoint)}
                  disabled={isLoading}
                >
                  {isLoading ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Running...
                    </>
                  ) : (
                    <>
                      <Play className="h-4 w-4 mr-2" />
                      Run Now
                    </>
                  )}
                </Button>
              </div>

              {result !== null && result !== undefined && (
                <div className="mt-4 p-4 bg-gray-50 rounded-lg">
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
          )
        })}
      </div>

      <div className="mt-8 bg-gray-50 rounded-lg p-6">
        <h2 className="text-lg font-semibold mb-4">Cron Job Schedules</h2>
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
      </div>
    </div>
  )
}