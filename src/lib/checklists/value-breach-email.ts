const LONDON_TIMEZONE = 'Europe/London'

type Measurement = number | string | null

export interface ValueBreachEmailInput {
  title: string
  instruction: string | null
  department: string
  recordedValue: Measurement
  valueUnit: string | null
  valueMin: Measurement
  valueMax: Measurement
  completedByName: string
  completedAt: string
  notes: string | null
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;',
  })[character] as string)
}

function asNumber(value: Measurement): number | null {
  if (value == null || value === '') return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function measurementLabel(value: Measurement, unit: string | null): string {
  const number = asNumber(value)
  const valueLabel = number == null ? 'Not recorded' : String(number)
  const cleanUnit = unit?.trim()
  if (!cleanUnit) return valueLabel
  const separator = /^[%°]/.test(cleanUnit) ? '' : ' '
  return `${valueLabel}${separator}${cleanUnit}`
}

function rangeLabel(input: ValueBreachEmailInput): string {
  if (input.valueMin != null && input.valueMax != null) {
    return `${measurementLabel(input.valueMin, input.valueUnit)} to ${measurementLabel(input.valueMax, input.valueUnit)}`
  }
  if (input.valueMin != null) return `${measurementLabel(input.valueMin, input.valueUnit)} or above`
  if (input.valueMax != null) return `${measurementLabel(input.valueMax, input.valueUnit)} or below`
  return 'No range recorded'
}

function problemDetails(input: ValueBreachEmailInput): { summary: string; subjectState: string } {
  const recorded = asNumber(input.recordedValue)
  const min = asNumber(input.valueMin)
  const max = asNumber(input.valueMax)
  const recordedLabel = measurementLabel(input.recordedValue, input.valueUnit)

  if (recorded != null && min != null && recorded < min) {
    return {
      summary: `The recorded value of ${recordedLabel} is below the minimum of ${measurementLabel(input.valueMin, input.valueUnit)}.`,
      subjectState: 'is below the limit',
    }
  }
  if (recorded != null && max != null && recorded > max) {
    return {
      summary: `The recorded value of ${recordedLabel} is above the maximum of ${measurementLabel(input.valueMax, input.valueUnit)}.`,
      subjectState: 'is above the limit',
    }
  }
  return {
    summary: `The recorded value of ${recordedLabel} is outside the expected range.`,
    subjectState: 'is out of range',
  }
}

function completedAtLabel(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZone: LONDON_TIMEZONE,
  }).format(date)
}

export function buildValueBreachEmail(input: ValueBreachEmailInput): {
  subject: string
  bodyHtml: string
} {
  const problem = problemDetails(input)
  const title = input.title.replace(/\s+/g, ' ').trim() || 'Checklist reading'
  const recorded = measurementLabel(input.recordedValue, input.valueUnit)
  const detailRows = [
    ['Task', title],
    ['Problem', problem.summary],
    ['Recorded value', recorded],
    ['Expected range', rangeLabel(input)],
    ['Department', input.department || 'Not recorded'],
    ['Completed by', input.completedByName],
    ['Completed at', completedAtLabel(input.completedAt)],
  ]

  if (input.instruction) detailRows.push(['Instructions', input.instruction])
  if (input.notes) detailRows.push(['Team note', input.notes])

  const rowsHtml = detailRows
    .map(([label, value]) => `<tr>
      <td style="padding:8px 12px 8px 0;color:#666;vertical-align:top;white-space:nowrap">${escapeHtml(label)}</td>
      <td style="padding:8px 0;font-weight:600;vertical-align:top">${escapeHtml(value)}</td>
    </tr>`)
    .join('')

  return {
    subject: `Checklist alert: ${title} ${problem.subjectState} (${recorded})`,
    bodyHtml: `<div style="font-family:Arial,sans-serif;max-width:640px;margin:0 auto;color:#222">
      <h2 style="margin-bottom:8px">Checklist reading needs attention</h2>
      <p style="margin-top:0">${escapeHtml(problem.summary)}</p>
      <table role="presentation" style="border-collapse:collapse;width:100%;margin:20px 0">${rowsHtml}</table>
      <p>Please review this reading and take any needed action.</p>
    </div>`,
  }
}
