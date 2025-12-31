import 'server-only'
import { sendEmail } from '@/lib/email/emailService'
import type { HiringApplication, HiringCandidate, HiringJob } from '@/types/database'
import type { ScreeningEligibilityItem, ScreeningResult } from '@/lib/hiring/screening'

const MANAGER_EMAIL = 'manager@the-anchor.pub'
const APP_URL_FALLBACK = 'https://management.orangejelly.co.uk'

function formatStatus(status: ScreeningEligibilityItem['status']) {
    if (status === 'yes') return 'Yes'
    if (status === 'no') return 'No'
    return 'Unclear'
}

function formatRecommendation(value: ScreeningResult['recommendation']) {
    if (value === 'invite') return 'Invite'
    if (value === 'clarify') return 'Clarify'
    if (value === 'hold') return 'Hold'
    if (value === 'reject') return 'Reject'
    return value
}

function extractKeyFlags(eligibility: ScreeningEligibilityItem[]) {
    const patterns = [
        { label: 'Commute', matcher: /commute|distance|travel|postcode|location/i },
        { label: 'Weekends', matcher: /weekend|rota|availability/i },
        { label: 'Right to work', matcher: /right to work|visa|permit|eligibility/i },
    ]

    const matched: ScreeningEligibilityItem[] = []

    for (const pattern of patterns) {
        const found = eligibility.find((item) => {
            const haystack = `${item.key ?? ''} ${item.label ?? ''}`
            return pattern.matcher.test(haystack)
        })
        if (found) matched.push(found)
    }

    if (matched.length > 0) {
        return matched.map((item) => ({
            label: item.label || item.key || 'Flag',
            status: formatStatus(item.status),
            justification: item.justification,
        }))
    }

    return eligibility.slice(0, 3).map((item) => ({
        label: item.label || item.key || 'Flag',
        status: formatStatus(item.status),
        justification: item.justification,
    }))
}

export async function sendNewApplicationNotification(input: {
    application: HiringApplication
    candidate: HiringCandidate
    job: HiringJob
    screening: ScreeningResult
}) {
    const { application, candidate, job, screening } = input
    const candidateName = [candidate.first_name, candidate.last_name].filter(Boolean).join(' ') || 'Candidate'
    const scoreLabel = `${screening.score}/10`
    const recommendationLabel = formatRecommendation(screening.recommendation)
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || APP_URL_FALLBACK
    const applicationLink = `${appUrl}/hiring/applications/${application.id}`
    const keyFlags = extractKeyFlags(screening.eligibility || [])

    const contactLines = [
        candidate.email ? `Email: ${candidate.email}` : null,
        candidate.phone ? `Phone: ${candidate.phone}` : null,
        candidate.location ? `Location: ${candidate.location}` : null,
        application.source ? `Source: ${application.source}` : null,
    ].filter(Boolean)

    const keyFlagRows = keyFlags.length
        ? keyFlags
            .map((flag) => `
            <tr>
              <td style="padding: 6px 8px; border: 1px solid #e5e7eb;"><strong>${flag.label}</strong></td>
              <td style="padding: 6px 8px; border: 1px solid #e5e7eb;">${flag.status}</td>
              <td style="padding: 6px 8px; border: 1px solid #e5e7eb;">${flag.justification}</td>
            </tr>
          `)
            .join('')
        : '<tr><td style="padding: 6px 8px; border: 1px solid #e5e7eb;" colspan="3">No key flags available.</td></tr>'

    const html = `
    <div style="font-family: Arial, sans-serif;">
      <h2 style="margin-bottom: 6px;">New application: ${job.title}</h2>
      <p style="margin-top: 0; color: #4b5563;">${candidateName}</p>
      ${contactLines.length ? `<p style="margin-top: 0;">${contactLines.join('<br>')}</p>` : ''}
      <p><strong>AI score:</strong> ${scoreLabel} (${recommendationLabel})</p>
      <p style="margin-bottom: 16px;"><strong>Rationale:</strong> ${screening.rationale}</p>
      <h3 style="margin-bottom: 6px;">Key flags</h3>
      <table style="border-collapse: collapse; width: 100%; margin-bottom: 16px;">
        <thead>
          <tr style="background-color: #f3f4f6;">
            <th style="padding: 6px 8px; border: 1px solid #e5e7eb; text-align: left;">Flag</th>
            <th style="padding: 6px 8px; border: 1px solid #e5e7eb; text-align: left;">Status</th>
            <th style="padding: 6px 8px; border: 1px solid #e5e7eb; text-align: left;">Notes</th>
          </tr>
        </thead>
        <tbody>
          ${keyFlagRows}
        </tbody>
      </table>
      <p><a href="${applicationLink}">View application</a></p>
    </div>
  `

    const subject = `New application: ${job.title} - ${candidateName} (${scoreLabel} ${recommendationLabel})`

    const emailResult = await sendEmail({
        to: MANAGER_EMAIL,
        subject,
        html,
    })

    if (!emailResult.success) {
        console.error('[Hiring] Failed to send manager notification:', emailResult.error)
    }

    return emailResult
}
