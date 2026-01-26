import { COMPANY_DETAILS } from '@/lib/company-details'
import { formatDateDdMmmmYyyy, getTodayIsoDate } from '@/lib/dateUtils'

export interface EmploymentContractEmployee {
  employee_id: string
  first_name: string
  last_name: string
  job_title: string | null
  address: string | null
  post_code: string | null
  employment_start_date: string | null
}

export interface EmploymentContractTemplateData {
  employee: EmploymentContractEmployee
  logoUrl?: string
}

function escapeHtml(value: string): string {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

function placeholderLine(): string {
  return '<span class="placeholder">_______________________________________</span>'
}

function formatTextOrPlaceholder(value: string | null | undefined): string {
  const trimmed = typeof value === 'string' ? value.trim() : ''
  if (!trimmed) return placeholderLine()
  return escapeHtml(trimmed)
}

function formatAddressHtml(address: string | null, postCode: string | null): string {
  const combined = [address?.trim(), postCode?.trim()].filter(Boolean).join(', ')
  if (!combined) return placeholderLine()

  // Convert commas/newlines into <br> for clean PDF layout.
  const escaped = escapeHtml(combined)
  return escaped.replaceAll('\n', '<br>').replaceAll(/,\s*/g, '<br>')
}

export function generateEmploymentContractHTML(data: EmploymentContractTemplateData): string {
  const { employee, logoUrl } = data

  const workerName = `${employee.first_name} ${employee.last_name}`.trim()
  const workerJobTitle = employee.job_title?.trim() || ''

  const agreementDate = formatDateDdMmmmYyyy(employee.employment_start_date ?? getTodayIsoDate())

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Agreement of Employment - ${escapeHtml(workerName || 'Worker')}</title>
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
      font-size: 10pt;
    }

    .header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      padding-bottom: 12px;
      border-bottom: 2px solid #005131;
      margin-bottom: 18px;
    }

    .logo {
      height: 48px;
      width: auto;
      object-fit: contain;
    }

    .brand {
      text-align: right;
    }

    .brand .name {
      font-size: 14pt;
      font-weight: bold;
      color: #005131;
      margin: 0;
    }

    .brand .details {
      margin: 4px 0 0 0;
      color: #4b5563;
      font-size: 8.5pt;
      line-height: 1.35;
    }

    h1 {
      font-size: 18pt;
      margin: 0 0 6px 0;
      color: #005131;
      letter-spacing: 0.2px;
    }

    .subtitle {
      margin: 0 0 18px 0;
      color: #374151;
      font-size: 10pt;
    }

    .date-line {
      margin: 0 0 18px 0;
      font-size: 10pt;
    }

    .date-line strong {
      color: #111827;
    }

    .section-title {
      margin: 18px 0 8px 0;
      font-size: 12pt;
      color: #005131;
      border-bottom: 1px solid #d1d5db;
      padding-bottom: 4px;
    }

    .contract-section {
      break-inside: avoid;
      page-break-inside: avoid;
    }

    .contract-section .section-title {
      break-after: avoid;
      page-break-after: avoid;
    }

    .paragraph {
      margin: 8px 0;
    }

    .bullets {
      margin: 6px 0 10px 18px;
      padding: 0;
      break-inside: avoid;
      page-break-inside: avoid;
    }

    .bullets li {
      margin: 4px 0;
    }

    .details-table {
      width: 100%;
      border-collapse: collapse;
      margin: 8px 0 10px 0;
      break-inside: avoid;
      page-break-inside: avoid;
    }

    .details-table td {
      vertical-align: top;
      padding: 6px 8px;
      border: 1px solid #e5e7eb;
      font-size: 9.5pt;
    }

    .details-table td.label {
      width: 32%;
      background: #f9fafb;
      color: #374151;
      font-weight: bold;
    }

    .placeholder {
      color: #111827;
      letter-spacing: 0.6px;
      white-space: nowrap;
    }

    .signature-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 18px;
      margin-top: 12px;
      break-inside: avoid;
      page-break-inside: avoid;
    }

    .signature-block {
      border: 1px solid #e5e7eb;
      background: #f9fafb;
      padding: 10px 12px;
      border-radius: 4px;
      break-inside: avoid;
      page-break-inside: avoid;
    }

    .signature-label {
      font-weight: bold;
      margin-bottom: 10px;
      color: #374151;
    }

    .signature-line {
      border-bottom: 1px solid #111827;
      height: 18px;
      margin: 14px 0 10px 0;
    }

    .signature-date {
      display: flex;
      gap: 8px;
      align-items: center;
      color: #374151;
      font-size: 9.5pt;
    }

    .signature-date .line {
      flex: 1;
      border-bottom: 1px solid #111827;
      height: 18px;
    }

  </style>
</head>
<body>
  <div class="header">
    <div>
      ${logoUrl ? `<img class="logo" src="${logoUrl}" alt="The Anchor logo" />` : ''}
    </div>
    <div class="brand">
      <p class="name">${escapeHtml(COMPANY_DETAILS.tradingName)}</p>
      <p class="details">
        ${escapeHtml(COMPANY_DETAILS.fullAddress)}<br />
        ${escapeHtml(COMPANY_DETAILS.phone)} • ${escapeHtml(COMPANY_DETAILS.email)}
      </p>
    </div>
  </div>

  <h1>Agreement of Employment</h1>
  <p class="subtitle">Casual Worker Agreement</p>

  <p class="date-line">
    <strong>The date of this agreement is</strong> ${formatTextOrPlaceholder(agreementDate)}
  </p>

  <div class="contract-section">
    <h2 class="section-title">1. Parties and Duration</h2>
    <table class="details-table">
      <tr>
        <td class="label">Employer</td>
        <td>${escapeHtml(COMPANY_DETAILS.legalName)}</td>
      </tr>
      <tr>
        <td class="label">Employer Address</td>
        <td>${escapeHtml(COMPANY_DETAILS.fullAddress).replaceAll(/,\s*/g, '<br>')}</td>
      </tr>
      <tr>
        <td class="label">Worker</td>
        <td>${formatTextOrPlaceholder(workerName)}</td>
      </tr>
      <tr>
        <td class="label">Worker Address</td>
        <td>${formatAddressHtml(employee.address, employee.post_code)}</td>
      </tr>
    </table>

    <p class="paragraph">
      This agreement governs your engagement as a casual worker. This is not an employment contract and does not confer any employment rights on you (other than those to which workers are entitled). There is no obligation for the Employer to provide regular work, and you will work on a flexible &quot;as required&quot; basis.
    </p>
  </div>

  <div class="contract-section">
    <h2 class="section-title">2. Job Title and Duties</h2>
    <p class="paragraph">
      Your role will be that of ${formatTextOrPlaceholder(workerJobTitle)}, and your specific duties and responsibilities are set out in the job description. You may be required to undertake other duties as reasonably requested. Your place of work will be ${escapeHtml(COMPANY_DETAILS.fullAddress)}, but you may be required to work at other locations as needed.
    </p>
  </div>

  <div class="contract-section">
    <h2 class="section-title">3. Hours of Work</h2>
    <p class="paragraph">
      Your hours of work will vary depending on the Employer’s needs. You will be informed of the required hours for each assignment. There is no guarantee of a minimum number of hours.
    </p>
    <p class="paragraph">
      You are expected to arrive 10 minutes before your shift is scheduled to begin to ensure that you are ready to start work at your scheduled time. This time allows you to put your personal belongings away and prepare yourself for work. You may also be expected to stay up to 15 minutes after your shift ends. These additional 10 minutes before and 15 minutes after your shift are unpaid.
    </p>
    <p class="paragraph">
      We encourage you to follow the closing down procedures accurately to ensure you can leave on time. However, we want to be clear that we will not be paying beyond your scheduled hours unless it has been agreed by Management in advance, without exception.
    </p>
    <p class="paragraph">
      You will be entitled to an unpaid break of 30 minutes if your shift exceeds six hours.
    </p>
  </div>

  <div class="contract-section">
    <h2 class="section-title">4. Pay</h2>
    <p class="paragraph">
      All working hours will be paid at the National Minimum Wage. You are required to use the WhenIWork system to track and submit your timesheets. Deductions may be made for overpayments or sums owed to the Employer. No payment will be made for unauthorised absences or unapproved overtime.
    </p>
  </div>

  <div class="contract-section">
    <h2 class="section-title">5. Holiday Entitlement</h2>
    <p class="paragraph">
      Your holiday entitlement is pro-rated based on hours worked, equivalent to 12.07% of hours worked over the year. The holiday year runs from April 1st to March 31st. Holiday pay will be calculated and included in your pay each pay cycle. You must provide two weeks' notice for annual leave. You must get permission for unpaid time off, and we may refuse permission to take the time off that you want. Additionally, you must get written approval for taking any more than 7 days in a row.
    </p>
  </div>

  <div class="contract-section">
    <h2 class="section-title">6. Absence</h2>
    <p class="paragraph">
      If you are unable to attend work due to sickness or other reasons, inform Management personally by telephone as soon as possible, and at least 4 hours before your shift. Any absence will require an absence form to be completed within 7 days. For absences longer than 7 days, you will be required to provide a medical certificate from your doctor. Failure to follow this procedure may be considered misconduct. Any other method for reporting sickness will result in a warning.
    </p>
  </div>

  <div class="contract-section">
    <h2 class="section-title">7. Probationary Period</h2>
    <p class="paragraph">
      During the initial three-month probation period, either party may terminate the engagement without notice if they are dissatisfied for any reason. The Employer reserves the right to extend the probationary period indefinitely if deemed necessary. During the probationary period, you may or may not receive keys based on your performance. After successfully completing the probationary period, both the Employer and the Worker must provide a notice period of one week if either party wishes to terminate the engagement.
    </p>
  </div>

  <div class="contract-section">
    <h2 class="section-title">8. Termination and Notice</h2>
    <p class="paragraph">
      If you wish to stop being considered for casual work, inform the Employer as soon as possible. The Employer may terminate this agreement immediately for any serious breach or gross misconduct, including dishonesty, theft, fighting, misuse of drugs or alcohol, breach of confidentiality, and neglect.
    </p>
  </div>

  <div class="contract-section">
    <h2 class="section-title">9. Confidentiality and Other Clauses</h2>
    <p class="paragraph">
      You must respect the privacy of the Employer and maintain confidentiality regarding any information obtained during your assignments. Any breach of confidentiality will be treated as gross misconduct.
    </p>
    <p class="paragraph">
      It is a condition of your engagement that you hold a valid driving licence if required for your duties. Notify the Employer immediately if your licence status changes or if you develop a medical condition affecting your ability to drive.
    </p>
  </div>

  <div class="contract-section">
    <h2 class="section-title">10. Disciplinary and Grievance Procedures</h2>
    <p class="paragraph">
      These procedures are not contractual. Disciplinaries will follow the Employer’s policies or ACAS codes of practice. Grievances should be presented in writing to the Employer.
    </p>
  </div>

  <div class="contract-section">
    <h2 class="section-title">11. Pensions</h2>
    <p class="paragraph">
      You will be enrolled in a qualifying contributory pension scheme once you become eligible under the auto-enrolment rules. Contributions will be deducted from your salary as per the scheme rules.
    </p>
  </div>

  <div class="contract-section">
    <h2 class="section-title">12. Training</h2>
    <p class="paragraph">
      You must complete the following training, which will not be paid for by the Company and is to take place outside normal working hours:
    </p>
    <ul class="bullets">
      <li>Health &amp; Safety Level 2</li>
      <li>Licensing England &amp; Wales</li>
      <li>COSHH: Working with Hazardous Substances – UK</li>
      <li>Customer Service</li>
      <li>Food Safety Level 2</li>
    </ul>
  </div>

  <div class="contract-section">
    <h2 class="section-title">13. Property Return</h2>
    <p class="paragraph">
      If we provide any property for you to use (including a uniform, keys, or access cards), you must return them to us immediately if we ask or when your employment ends. If keys are provided and are lost for any reason, the full cost of replacing the locks and getting new keys cut will be deducted from your pay.
    </p>
  </div>

  <div class="contract-section">
    <h2 class="section-title">14. Deductions</h2>
    <p class="paragraph">
      We can deduct from your pay any overpayments we have made to you or any losses you have caused by wasting stock (for example, broken glasses or cash or stock shortages attributable to you). If you owe us any money when your employment ends, we will take this from your final pay.
    </p>
  </div>

  <div class="contract-section">
    <h2 class="section-title">15. Extra Clauses</h2>
    <ul class="bullets">
      <li>If we provide any property for you to use (including a uniform, keys or access cards), you must return them to us immediately if we ask or when your employment ends.</li>
      <li>You must not drink alcohol or take drugs (except those prescribed by your GP as long as they do not affect your ability to work safely) at any time while you are at work or before coming to work or starting your shift.</li>
      <li>If you have access to any confidential information about our business while you work for us, you must use it only in the interests of the business and must not share it with anyone outside our business. This obligation continues to apply when your employment terminates, for whatever reason.</li>
      <li>If you work for another employer as well as us, you must inform Management before you start the other employment so we can ensure compliance with the Working Time Regulations. Additionally, you are not allowed to work for another public house within a 5-mile radius while employed with us.</li>
      <li>We can take from your pay any overpayments we have made to you or any losses you have caused by wasting stock (for example, broken glasses, or cash or stock shortages which are down to you). If you owe us any money when your employment ends, we will take this from your final pay.</li>
      <li>Hygiene and appearance are important to us. You must keep to our rules about this and be clean and smart at all times. You must dress in line with our rules. This may include wearing a uniform.</li>
    </ul>
  </div>

  <div class="contract-section">
    <h2 class="section-title">16. Signatures</h2>

    <div class="signature-grid">
      <div class="signature-block">
        <div class="signature-label">Worker</div>
        <div class="signature-line"></div>
        <div class="signature-date"><span>Date</span><span class="line"></span></div>
      </div>
      <div class="signature-block">
        <div class="signature-label">Employer</div>
        <div class="signature-line"></div>
        <div class="signature-date"><span>Date</span><span class="line"></span></div>
        <div class="paragraph" style="margin-top: 10px; font-size: 9pt; color: #4b5563;">
          On behalf of: <strong>${escapeHtml(COMPANY_DETAILS.legalName)}</strong>
        </div>
      </div>
    </div>
  </div>
</body>
</html>`
}
