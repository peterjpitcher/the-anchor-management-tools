import { COMPANY_DETAILS } from '@/lib/company-details'
import { formatDateDdMmmmYyyy } from '@/lib/dateUtils'

export interface StarterPackEmployee {
  employee_id: string
  first_name: string
  last_name: string
  email_address: string | null
  job_title: string | null
  status: string
  employment_start_date: string | null
  first_shift_date: string | null
  date_of_birth: string | null
  address: string | null
  post_code: string | null
  phone_number: string | null
  mobile_number: string | null
}

export interface StarterPackNiDetails {
  ni_number: string | null
}

export interface StarterPackRightToWork {
  document_type: string
  verification_date: string
  document_expiry_date: string | null
  document_reference: string | null
  check_method: string | null
  verified_by_name: string | null
}

export interface StarterPackTemplateData {
  employee: StarterPackEmployee
  niDetails: StarterPackNiDetails | null
  rightToWork: StarterPackRightToWork | null
  /** Base64 data URL for an image RTW document (e.g. "data:image/jpeg;base64,...") */
  rtwImageDataUrl?: string
  logoUrl?: string
  generatedDate: string
}

function escapeHtml(value: string): string {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

function fmt(value: string | null | undefined, fallback = '—'): string {
  const trimmed = typeof value === 'string' ? value.trim() : ''
  return trimmed ? escapeHtml(trimmed) : fallback
}

function fmtDate(value: string | null | undefined, fallback = '—'): string {
  if (!value) return fallback
  try {
    return formatDateDdMmmmYyyy(value)
  } catch {
    return fallback
  }
}

function row(label: string, value: string): string {
  return `
    <tr>
      <td class="label">${label}</td>
      <td class="value">${value}</td>
    </tr>`
}

function sectionHeader(title: string): string {
  return `<tr class="section-header"><td colspan="2">${title}</td></tr>`
}

export function generateEmployeeStarterHTML(data: StarterPackTemplateData): string {
  const { employee, niDetails, rightToWork, rtwImageDataUrl, logoUrl, generatedDate } = data

  const fullName = `${employee.first_name} ${employee.last_name}`.trim()
  const address = [employee.address?.trim(), employee.post_code?.trim()].filter(Boolean).join(', ')

  const checkMethodLabel: Record<string, string> = {
    manual: 'Manual',
    online: 'Online (Home Office)',
    digital: 'Digital (ID Service Provider)',
  }

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>New Starter Information — ${escapeHtml(fullName)}</title>
  <style>
    @page {
      size: A4;
      margin: 15mm;
    }

    body {
      font-family: Arial, sans-serif;
      line-height: 1.45;
      color: #111827;
      margin: 0;
      padding: 0;
      font-size: 9.8pt;
    }

    .header {
      text-align: center;
      padding-bottom: 12px;
      border-bottom: 2px solid #005131;
      margin-bottom: 20px;
    }

    .logo {
      height: 56px;
      width: auto;
      object-fit: contain;
      display: block;
      margin: 0 auto 8px auto;
    }

    .masthead-name {
      font-size: 14pt;
      font-weight: bold;
      color: #005131;
      margin: 0 0 2px 0;
    }

    .masthead-details {
      font-size: 8.5pt;
      color: #374151;
      margin: 0;
    }

    .doc-title {
      font-size: 16pt;
      font-weight: bold;
      color: #111827;
      margin: 14px 0 2px 0;
    }

    .doc-subtitle {
      font-size: 10pt;
      color: #374151;
      margin: 0;
    }

    .meta {
      font-size: 8pt;
      color: #6b7280;
      margin-top: 4px;
    }

    table.details {
      width: 100%;
      border-collapse: collapse;
      margin-bottom: 14px;
      font-size: 9.5pt;
    }

    table.details tr.section-header td {
      background: #005131;
      color: #ffffff;
      font-weight: bold;
      font-size: 9pt;
      padding: 5px 8px;
      letter-spacing: 0.03em;
    }

    table.details td.label {
      width: 38%;
      color: #374151;
      font-weight: bold;
      padding: 5px 8px;
      vertical-align: top;
      border-bottom: 1px solid #e5e7eb;
      background: #f9fafb;
    }

    table.details td.value {
      color: #111827;
      padding: 5px 8px;
      vertical-align: top;
      border-bottom: 1px solid #e5e7eb;
    }

    .rtw-status {
      display: inline-block;
      background: #d1fae5;
      color: #065f46;
      font-weight: bold;
      border-radius: 4px;
      padding: 2px 8px;
      font-size: 8.5pt;
      margin-bottom: 6px;
    }

    .rtw-none {
      display: inline-block;
      background: #fee2e2;
      color: #991b1b;
      font-weight: bold;
      border-radius: 4px;
      padding: 2px 8px;
      font-size: 8.5pt;
      margin-bottom: 6px;
    }

    .confidential-banner {
      background: #fef3c7;
      border: 1px solid #d97706;
      border-radius: 4px;
      padding: 6px 10px;
      font-size: 8pt;
      color: #92400e;
      margin-bottom: 14px;
      text-align: center;
      font-weight: bold;
    }

    .rtw-document-section {
      margin-top: 14px;
      page-break-before: auto;
    }

    .rtw-document-heading {
      background: #005131;
      color: #ffffff;
      font-weight: bold;
      font-size: 9pt;
      padding: 5px 8px;
      letter-spacing: 0.03em;
      margin-bottom: 8px;
    }

    .rtw-document-image {
      max-width: 100%;
      height: auto;
      display: block;
      border: 1px solid #d1d5db;
    }

    .footer {
      margin-top: 20px;
      font-size: 7.5pt;
      color: #9ca3af;
      text-align: center;
      border-top: 1px solid #e5e7eb;
      padding-top: 8px;
    }
  </style>
</head>
<body>

  <div class="header">
    ${logoUrl ? `<img class="logo" src="${escapeHtml(logoUrl)}" alt="${escapeHtml(COMPANY_DETAILS.tradingName)} logo" />` : ''}
    <p class="masthead-name">${escapeHtml(COMPANY_DETAILS.tradingName)}</p>
    <p class="masthead-details">${escapeHtml(COMPANY_DETAILS.fullAddress)} &bull; ${escapeHtml(COMPANY_DETAILS.phone)}</p>
    <p class="doc-title">New Starter Information</p>
    <p class="doc-subtitle">${escapeHtml(fullName)}</p>
    <p class="meta">Generated ${escapeHtml(generatedDate)}</p>
  </div>

  <div class="confidential-banner">
    CONFIDENTIAL — For payroll and HR purposes only
  </div>

  <table class="details">
    ${sectionHeader('Personal Details')}
    ${row('Full Name', fmt(fullName))}
    ${row('Date of Birth', fmtDate(employee.date_of_birth))}
    ${row('Address', fmt(address))}
    ${row('Phone', fmt(employee.phone_number))}
    ${row('Mobile', fmt(employee.mobile_number))}
    ${row('Email', fmt(employee.email_address))}
  </table>

  <table class="details">
    ${sectionHeader('Employment Details')}
    ${row('Job Title', fmt(employee.job_title))}
    ${row('Employment Status', fmt(employee.status))}
    ${row('Start Date', fmtDate(employee.employment_start_date))}
    ${employee.first_shift_date ? row('First Shift Date', fmtDate(employee.first_shift_date)) : ''}
  </table>

  <table class="details">
    ${sectionHeader('Payroll')}
    ${row('NI Number', fmt(niDetails?.ni_number))}
  </table>

  <table class="details">
    ${sectionHeader('Right to Work')}
    ${rightToWork
      ? `
    <tr>
      <td class="label">Verification Status</td>
      <td class="value"><span class="rtw-status">Verified</span></td>
    </tr>
    ${row('Document Type', fmt(rightToWork.document_type))}
    ${row('Verification Date', fmtDate(rightToWork.verification_date))}
    ${rightToWork.document_expiry_date ? row('Document Expiry', fmtDate(rightToWork.document_expiry_date)) : ''}
    ${rightToWork.document_reference ? row('Document Reference', fmt(rightToWork.document_reference)) : ''}
    ${rightToWork.check_method ? row('Check Method', fmt(checkMethodLabel[rightToWork.check_method] ?? rightToWork.check_method)) : ''}
    ${rightToWork.verified_by_name ? row('Verified By', fmt(rightToWork.verified_by_name)) : ''}
      `
      : `<tr><td colspan="2" class="value"><span class="rtw-none">Not yet recorded</span></td></tr>`
    }
  </table>

  ${rtwImageDataUrl ? `
  <div class="rtw-document-section">
    <div class="rtw-document-heading">Right to Work Document</div>
    <img class="rtw-document-image" src="${rtwImageDataUrl}" alt="Right to Work Document" />
  </div>
  ` : ''}

  <div class="footer">
    ${escapeHtml(COMPANY_DETAILS.legalName)} trading as ${escapeHtml(COMPANY_DETAILS.tradingName)} &bull; Company No. ${escapeHtml(COMPANY_DETAILS.registrationNumber)}
  </div>

</body>
</html>`
}
