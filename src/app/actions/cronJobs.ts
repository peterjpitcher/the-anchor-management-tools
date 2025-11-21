'use server'

import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { logAuditEvent } from '@/app/actions/audit'

type JobConfig = {
  path: string
  method: 'GET' | 'POST'
  searchParams?: Record<string, string>
}

const JOBS: Record<
  'recurring-invoices' | 'invoice-reminders' | 'job-queue',
  JobConfig
> = {
  'recurring-invoices': {
    path: '/api/cron/recurring-invoices',
    method: 'GET',
  },
  'invoice-reminders': {
    path: '/api/cron/invoice-reminders',
    method: 'GET',
  },
  'job-queue': {
    path: '/api/jobs/process',
    method: 'POST',
  },
}

export type CronJobName = keyof typeof JOBS

export type CronJobResponse =
  | {
      success: true
      data: unknown
    }
  | {
      success: false
      error: string
      status?: number
      details?: unknown
    }

function resolveBaseUrl() {
  if (process.env.NEXT_PUBLIC_APP_URL) {
    return process.env.NEXT_PUBLIC_APP_URL
  }
  if (process.env.VERCEL_URL) {
    return `https://${process.env.VERCEL_URL}`
  }
  return 'http://localhost:3000'
}

export async function runCronJob(job: CronJobName): Promise<CronJobResponse> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return {
      success: false,
      error: 'Not authenticated',
    }
  }

  const admin = createAdminClient()
  const { data: permissionGranted, error: permissionError } = await admin.rpc(
    'user_has_permission',
    {
      p_user_id: user.id,
      p_module_name: 'settings',
      p_action: 'manage',
    },
  )

  const auditBase = {
    user_id: user.id,
    ...(user.email && { user_email: user.email }),
    resource_type: 'cron_job',
    resource_id: job,
  } as const

  if (permissionError) {
    console.error('Error verifying cron job permissions:', permissionError)
    await logAuditEvent({
      ...auditBase,
      operation_type: 'trigger',
      operation_status: 'failure',
      error_message: 'Failed to verify permissions',
    })
    return {
      success: false,
      error: 'Failed to verify permissions',
    }
  }

  if (permissionGranted !== true) {
    await logAuditEvent({
      ...auditBase,
      operation_type: 'trigger',
      operation_status: 'failure',
      error_message: 'Insufficient permissions to trigger cron job',
    })
    return {
      success: false,
      error: 'You do not have permission to trigger cron jobs',
    }
  }

  const jobConfig = JOBS[job]
  const baseUrl = resolveBaseUrl()

  const cronSecret = process.env.CRON_SECRET?.trim()
  const headers: HeadersInit = {}
  if (cronSecret) {
    headers.authorization = `Bearer ${cronSecret}`
  }

  try {
    const url = new URL(`${baseUrl}${jobConfig.path}`)
    if (jobConfig.searchParams) {
      Object.entries(jobConfig.searchParams).forEach(([key, value]) => {
        url.searchParams.set(key, value)
      })
    }

    const response = await fetch(url.toString(), {
      method: jobConfig.method,
      headers,
      cache: 'no-store',
    })

    const data = await response.json().catch(() => ({}))

    if (!response.ok) {
      await logAuditEvent({
        ...auditBase,
        operation_type: 'trigger',
        operation_status: 'failure',
        error_message: data?.error ?? `Failed to run ${job.replace('-', ' ')} job`,
        additional_info: { status: response.status, details: data },
      })
      return {
        success: false,
        error: data?.error ?? `Failed to run ${job.replace('-', ' ')} job`,
        status: response.status,
        details: data,
      }
    }

    await logAuditEvent({
      ...auditBase,
      operation_type: 'trigger',
      operation_status: 'success',
      new_values: { job, response: data },
    })

    return {
      success: true,
      data,
    }
  } catch (error) {
    console.error(`Error triggering cron job "${job}":`, error)
    await logAuditEvent({
      ...auditBase,
      operation_type: 'trigger',
      operation_status: 'failure',
      error_message: 'An unexpected error occurred while triggering the cron job',
      additional_info: {
        details: error instanceof Error ? error.message : String(error),
      },
    })
    return {
      success: false,
      error: 'An unexpected error occurred while triggering the cron job',
      details: error instanceof Error ? error.message : undefined,
    }
  }
}
