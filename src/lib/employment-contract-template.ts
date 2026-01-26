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
  const agreementDate = formatDateDdMmmmYyyy(getTodayIsoDate())

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Casual Worker Agreement - ${escapeHtml(workerName || 'Worker')}</title>
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
      margin-bottom: 16px;
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
      margin: 0;
      color: #4b5563;
      font-size: 9pt;
      line-height: 1.35;
    }

    h1 {
      text-align: center;
      font-size: 13.5pt;
      margin: 0 0 10px 0;
      color: #111827;
      letter-spacing: 0.6px;
      text-transform: uppercase;
    }

    .date-line {
      margin: 0 0 18px 0;
      font-size: 10pt;
      text-align: center;
      color: #374151;
    }

    .date-line strong {
      color: #111827;
    }

    .contract-section {
      break-inside: avoid;
      page-break-inside: avoid;
      margin-top: 14px;
    }

    .section-title {
      margin: 0 0 8px 0;
      font-size: 11.5pt;
      color: #005131;
      border-bottom: 1px solid #d1d5db;
      padding-bottom: 4px;
      break-after: avoid;
      page-break-after: avoid;
    }

    .clause {
      margin: 8px 0;
    }

    .clause-number {
      font-weight: bold;
      color: #111827;
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

    .subclauses {
      margin: 6px 0 10px 20px;
      padding: 0;
      break-inside: avoid;
      page-break-inside: avoid;
    }

    .subclauses li {
      margin: 4px 0;
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
      margin-top: 8px;
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
      font-size: 9.5pt;
    }

    .signature-row {
      display: flex;
      align-items: center;
      gap: 8px;
      margin: 10px 0;
      font-size: 9.5pt;
    }

    .signature-row-label {
      width: 78px;
      color: #374151;
      font-weight: bold;
    }

    .signature-row-line {
      flex: 1;
      border-bottom: 1px solid #111827;
      height: 18px;
    }
  </style>
</head>
<body>
  <div class="header">
    ${logoUrl ? `<img class="logo" src="${logoUrl}" alt="The Anchor logo" />` : ''}
    <p class="masthead-name">${escapeHtml(COMPANY_DETAILS.tradingName)}</p>
    <p class="masthead-details">
      ${escapeHtml(COMPANY_DETAILS.fullAddress)}<br />
      ${escapeHtml(COMPANY_DETAILS.phone)} • ${escapeHtml(COMPANY_DETAILS.email)}
    </p>
  </div>

  <h1>CASUAL WORKER AGREEMENT (WORKER CONTRACT)</h1>

  <p class="date-line">
    <strong>Date of this agreement:</strong> ${formatTextOrPlaceholder(agreementDate)}
  </p>

  <div class="contract-section">
    <h2 class="section-title">1. Parties</h2>

    <div class="clause">
      <span class="clause-number">1.1 Employer:</span><br />
      ${escapeHtml(COMPANY_DETAILS.legalName)} (trading as ${escapeHtml(COMPANY_DETAILS.tradingName)})<br />
      ${escapeHtml(COMPANY_DETAILS.fullAddress)}
    </div>

    <div class="clause">
      <span class="clause-number">1.2 Worker:</span><br />
      ${formatTextOrPlaceholder(workerName)}<br />
      ${formatAddressHtml(employee.address, employee.post_code)}
    </div>
  </div>

  <div class="contract-section">
    <h2 class="section-title">2. Status and nature of engagement</h2>

    <p class="clause">
      <span class="clause-number">2.1</span> This is a casual worker agreement (a worker contract). It is not a contract of employment. Nothing in this agreement guarantees you any minimum hours or regular work.
    </p>

    <p class="clause">
      <span class="clause-number">2.2</span> There is no obligation on us to offer you work and no obligation on you to accept work. Each shift we offer you (and you accept) is a separate assignment under this agreement.
    </p>

    <p class="clause">
      <span class="clause-number">2.3</span> Your start date for the purposes of this arrangement is the date of your first shift (“Start Date”), which will be confirmed to you separately.
    </p>

    <p class="clause">
      <span class="clause-number">2.4</span> You are free to work elsewhere, subject to clause 10 (Confidentiality, data protection and conflicts).
    </p>
  </div>

  <div class="contract-section">
    <h2 class="section-title">3. Role and place of work</h2>

    <p class="clause">
      <span class="clause-number">3.1</span> Your role will be <strong>Bartender</strong>. Your duties and responsibilities are set out in the job description. You may be required to carry out other reasonable duties consistent with your role and the needs of the business.
    </p>

    <p class="clause">
      <span class="clause-number">3.2</span> Your normal place of work will be ${escapeHtml(COMPANY_DETAILS.fullAddress)}. You may be asked to work at other locations on occasion (for example, temporary off-site events) where reasonably required.
    </p>
  </div>

  <div class="contract-section">
    <h2 class="section-title">4. Hours of work, timekeeping and breaks</h2>

    <p class="clause">
      <span class="clause-number">4.1</span> Your hours will vary depending on business needs. Shifts will be offered via rota and/or agreed with you in advance.
    </p>

    <p class="clause">
      <span class="clause-number">4.2</span> You are expected to be ready to start work at your scheduled start time. This means arriving with enough time to put personal belongings away and be in position to begin working when your shift starts.
    </p>

    <p class="clause">
      <span class="clause-number">4.3</span> You will be paid for all time you are required to work. If a manager asks you to start earlier, finish later, or remain for handover/closing tasks, you must record that time and it will be paid.
    </p>

    <p class="clause">
      <span class="clause-number">4.4</span> Additional time should be approved by a manager in advance wherever possible. Working unapproved extra time may be treated as a conduct issue, but any authorised or required time worked will be paid.
    </p>

    <p class="clause">
      <span class="clause-number">4.5</span> Breaks will be provided in line with the Working Time Regulations and business needs. If your shift exceeds 6 hours, you are entitled to an unpaid break of 30 minutes (unless alternative arrangements are agreed and notified to you).
    </p>

    <p class="clause">
      <span class="clause-number">4.6</span> Accurate timekeeping is essential. You must use the WhenIWork system to record and submit your timesheets. Deliberate falsification of timesheets is gross misconduct.
    </p>
  </div>

  <div class="contract-section">
    <h2 class="section-title">5. Pay, pay period and payroll</h2>

    <p class="clause">
      <span class="clause-number">5.1</span> Your hourly rate will be confirmed to you in writing and will be at least the applicable National Minimum Wage/National Living Wage.
    </p>

    <p class="clause">
      <span class="clause-number">5.2</span> Pay period: 25th of one month to the 24th of the next month.
    </p>

    <p class="clause">
      <span class="clause-number">5.3</span> Pay date: the last weekday of the month. Shifts worked within the pay period will be paid on that pay date.
    </p>

    <p class="clause">
      <span class="clause-number">5.4</span> This payroll timetable allows our accountants time to process timesheets, produce payslips and apply any lawful deductions. You must submit accurate timesheets promptly when requested so payroll can be processed.
    </p>

    <p class="clause">
      <span class="clause-number">5.5</span> No payment is made for time not worked (for example, unauthorised absence). If you cannot attend a scheduled shift, you must follow the absence reporting procedure in clause 7.
    </p>

    <p class="clause">
      <span class="clause-number">5.6</span> Overpayments: if we accidentally overpay you, we may recover the overpayment by deducting it from future pay or by another reasonable method, subject to clause 12 and the law.
    </p>
  </div>

  <div class="contract-section">
    <h2 class="section-title">6. Holiday and time off (rolled-up holiday pay)</h2>

    <p class="clause">
      <span class="clause-number">6.1</span> Holiday year: 1 April to 31 March.
    </p>

    <p class="clause">
      <span class="clause-number">6.2</span> You are entitled to statutory holiday. Because your hours are irregular, we pay holiday pay as “rolled-up holiday pay”.
    </p>

    <div class="clause">
      <span class="clause-number">6.3 Rolled-up holiday pay:</span>
      <ol class="subclauses" type="a">
        <li>An amount for holiday pay will be paid each pay period, calculated at 12.07% of your pay for work done in that pay period.</li>
        <li>Rolled-up holiday pay will be paid at the same time as your wages and will be shown as a separate line on your payslip.</li>
        <li>When you take holiday leave, you will not receive additional holiday pay at the time you take the leave because holiday pay has already been included in your pay through rolled-up holiday pay.</li>
      </ol>
    </div>

    <p class="clause">
      <span class="clause-number">6.4</span> Taking holiday is important. You are expected to take holiday during the holiday year. We may remind you to take leave to support health, safety and wellbeing.
    </p>

    <div class="clause">
      <span class="clause-number">6.5 Requesting time off:</span>
      <ol class="subclauses" type="a">
        <li>You must request holiday leave in advance and get approval before making firm plans.</li>
        <li>Unless we agree otherwise, you should give at least 2 weeks’ notice for holiday leave.</li>
        <li>We may refuse or amend holiday requests where necessary for business reasons (for example, to maintain safe staffing levels).</li>
        <li>Any request for more than 7 consecutive days must have written approval.</li>
      </ol>
    </div>

    <div class="clause">
      <span class="clause-number">6.6 Bank and public holidays:</span>
      <ol class="subclauses" type="a">
        <li>Bank/public holidays are treated like any other day in the hospitality trade and you may be scheduled to work them.</li>
        <li>There is no separate paid “bank holiday entitlement”. If you want a bank/public holiday off, you must request it as holiday leave (clause 6.5) or request unpaid time off (which may be refused).</li>
      </ol>
    </div>
  </div>

  <div class="contract-section">
    <h2 class="section-title">7. Absence and sickness reporting</h2>

    <p class="clause">
      <span class="clause-number">7.1</span> Reliability is essential in our business. If you are unable to attend a scheduled shift for any reason, you must tell us as soon as possible and, in any event, at least 4 hours before your shift starts.
    </p>

    <div class="clause">
      <span class="clause-number">7.2 How to report absence:</span>
      <ol class="subclauses" type="a">
        <li>You must telephone the duty manager/management. Messages by text/WhatsApp/social media are not an acceptable substitute unless we have agreed it in an emergency.</li>
        <li>If you are genuinely unable to call yourself (for example, you are in hospital), you must arrange for someone to telephone us on your behalf and explain why you cannot call.</li>
      </ol>
    </div>

    <div class="clause">
      <span class="clause-number">7.3 You must tell us:</span>
      <ol class="subclauses" type="a">
        <li>the reason for your absence</li>
        <li>how long you expect to be absent</li>
        <li>any updates if your return date changes</li>
      </ol>
    </div>

    <p class="clause">
      <span class="clause-number">7.4</span> You must complete an absence form within 7 days of returning to work.
    </p>

    <p class="clause">
      <span class="clause-number">7.5</span> If you are off sick for more than 7 calendar days, you must provide a fit note from your GP or other appropriate medical professional.
    </p>

    <p class="clause">
      <span class="clause-number">7.6</span> If you do not follow this reporting procedure, it may be treated as misconduct and may affect whether we offer you future shifts.
    </p>

    <div class="clause">
      <span class="clause-number">7.7 Managing absence:</span>
      <ol class="subclauses" type="a">
        <li>We understand people can become unwell. However, frequent or short-notice absences can create operational and safety issues.</li>
        <li>If you have repeated absences, patterns of absence, or reliability concerns, we may invite you to a meeting to discuss what support may be appropriate and whether we can continue to offer you shifts.</li>
        <li>Depending on the circumstances and business needs, ongoing attendance concerns may result in fewer shifts being offered, or no further shifts being offered.</li>
        <li>We will take account of any relevant medical information and our obligations under equality law, including considering reasonable adjustments where appropriate.</li>
      </ol>
    </div>
  </div>

  <div class="contract-section">
    <h2 class="section-title">8. Probation and performance</h2>

    <p class="clause">
      <span class="clause-number">8.1</span> Your probation period is 3 months from your Start Date (your first shift date), during which we will assess your suitability, performance, conduct and reliability.
    </p>

    <p class="clause">
      <span class="clause-number">8.2</span> We may extend probation if needed, up to a maximum total probation period of 6 months.
    </p>

    <div class="clause">
      <span class="clause-number">8.3</span> During probation, either you or we may end the arrangement at any time. In practice, this means:
      <ol class="subclauses" type="a">
        <li>you can tell us you no longer wish to be offered shifts; and/or</li>
        <li>we can stop offering you further shifts.</li>
      </ol>
    </div>

    <p class="clause">
      <span class="clause-number">8.4</span> If you have not passed probation by the end of 6 months because you are unable to deliver the responsibilities required (including due to performance, conduct or reliability concerns), we will not offer any further shifts.
    </p>

    <p class="clause">
      <span class="clause-number">8.5</span> Keys and access may be issued at our discretion and can be withdrawn at any time.
    </p>
  </div>

  <div class="contract-section">
    <h2 class="section-title">9. Standards of conduct</h2>

    <p class="clause">
      <span class="clause-number">9.1</span> You must follow all reasonable management instructions, policies and procedures, and all legal requirements relevant to the pub (including licensing obligations).
    </p>

    <p class="clause">
      <span class="clause-number">9.2 Alcohol and drugs:</span> You must not be under the influence of alcohol or non-prescribed drugs during working time. You must not consume alcohol while working. Prescribed medication must not adversely affect your ability to work safely; if it might, you must inform management.
    </p>

    <p class="clause">
      <span class="clause-number">9.3</span> Presentation and hygiene are important. You must be clean and smart at all times and follow our dress/uniform standards as notified to you.
    </p>
  </div>

  <div class="contract-section">
    <h2 class="section-title">10. Confidentiality, data protection and conflicts</h2>

    <p class="clause">
      <span class="clause-number">10.1 Confidentiality:</span> You must keep confidential any non-public information about the business, staff, customers, suppliers, pricing, operations and security. This applies during and after your engagement.
    </p>

    <p class="clause">
      <span class="clause-number">10.2 Data protection:</span> If you handle any personal data (for example, customer details), you must do so only for legitimate business purposes, keep it secure, and follow our data protection instructions. Unauthorised sharing of personal data is a serious matter and may be gross misconduct.
    </p>

    <div class="clause">
      <span class="clause-number">10.3 Conflicts of interest and outside work:</span>
      <ol class="subclauses" type="a">
        <li>You must not use our confidential information for any other job or business.</li>
        <li>You must not solicit our staff or knowingly divert customers away from The Anchor for the benefit of another business.</li>
        <li>If you take other work, you must tell management if it could affect your availability, rest breaks, or compliance with the Working Time Regulations, or if it creates a material conflict of interest.</li>
      </ol>
    </div>
  </div>

  <div class="contract-section">
    <h2 class="section-title">11. Training</h2>

    <p class="clause">
      <span class="clause-number">11.1</span> You must complete the training we require for your role, which may include:
    </p>
    <ul class="bullets">
      <li>Health &amp; Safety Level 2</li>
      <li>Licensing (England &amp; Wales)</li>
      <li>COSHH</li>
      <li>Customer Service</li>
      <li>Food Safety Level 2</li>
      <li>(and any other training we notify you about)</li>
    </ul>

    <p class="clause">
      <span class="clause-number">11.2</span> The expectation is that training will be completed during quieter periods while you are working, where operationally possible. Training must never be done where it would compromise customer service or safety.
    </p>

    <p class="clause">
      <span class="clause-number">11.3</span> All mandatory training must be completed by the end of your third month with us. If you have not been able to complete training due to busy shifts, you must speak to management in good time so we can agree when and how it will be completed before the end of month 3.
    </p>

    <p class="clause">
      <span class="clause-number">11.4</span> Time spent completing mandatory training as required by us will be treated as working time and paid.
    </p>

    <p class="clause">
      <span class="clause-number">11.5</span> If mandatory training is not completed within the required timeframe, we may pause offering shifts until it is completed, or end the arrangement and offer no further shifts.
    </p>
  </div>

  <div class="contract-section">
    <h2 class="section-title">12. Company property, return of items and deductions</h2>

    <p class="clause">
      <span class="clause-number">12.1</span> If we provide property for you to use (for example, uniform, keys, access cards, equipment), it remains our property and must be looked after and returned immediately on request, and in any event when your engagement ends.
    </p>

    <p class="clause">
      <span class="clause-number">12.2</span> You are responsible for taking reasonable care of our property. You must report any loss, damage, or security concern immediately.
    </p>

    <p class="clause">
      <span class="clause-number">12.3</span> If you fail to return company property, or if property is lost or damaged due to your negligence, misuse or failure to follow reasonable instructions, you may be required to pay the reasonable cost of repair or replacement.
    </p>

    <div class="clause">
      <span class="clause-number">12.4 Deductions from pay:</span>
      <ol class="subclauses" type="a">
        <li>
          Where permitted by law, we may deduct from your pay:
          <ul class="bullets">
            <li>overpayments</li>
            <li>agreed sums owed to us</li>
            <li>reasonable costs under clause 12.3</li>
            <li>cash shortages or stock deficiencies attributable to you (subject to the special limits for retail/restaurant work and clause 12.5)</li>
          </ul>
        </li>
        <li>We will provide written details of any proposed deduction and give you a reasonable opportunity to raise questions or provide information before a deduction is made.</li>
        <li>Deductions will only be made where lawful and authorised by this agreement and/or your written consent. Where a deduction cannot lawfully be made from wages (for example, due to statutory limits), we may require repayment by another reasonable method (for example, an invoice and agreed repayment plan).</li>
      </ol>
    </div>

    <p class="clause">
      <span class="clause-number">12.5 Special limits for cash shortages/stock deficiencies:</span> Where deductions relate to till shortages or stock deficiencies in retail/restaurant work, we will follow the statutory limits and will not deduct more than the applicable maximum from your gross pay in a pay period (except from final pay where the law allows).
    </p>

    <p class="clause">
      <span class="clause-number">12.6 Keys and security:</span> If you are issued keys/access and they are lost or not returned, we may need to take security action (including changing locks). Where this is necessary and the loss/non-return is attributable to you, we may seek to recover reasonable associated costs in line with this clause.
    </p>
  </div>

  <div class="contract-section">
    <h2 class="section-title">13. Disciplinary and grievance procedures</h2>

    <p class="clause">
      <span class="clause-number">13.1</span> Our policies and procedures (including disciplinary and grievance) are not contractual and may be updated from time to time.
    </p>

    <p class="clause">
      <span class="clause-number">13.2</span> We aim to follow a fair process and relevant ACAS guidance. Grievances should be raised in writing to management.
    </p>
  </div>

  <div class="contract-section">
    <h2 class="section-title">14. Pension</h2>

    <p class="clause">
      <span class="clause-number">14.1</span> You will be auto-enrolled into a qualifying pension scheme when you meet the eligibility criteria under the auto-enrolment rules. Contributions will be deducted in line with scheme rules.
    </p>
  </div>

  <div class="contract-section">
    <h2 class="section-title">15. Tips and service charge</h2>

    <p class="clause">
      <span class="clause-number">15.1</span> We do not add a service charge to bills and we do not accept tips via card terminals or card payments.
    </p>

    <p class="clause">
      <span class="clause-number">15.2</span> If a customer chooses to give you a cash tip directly, this is a voluntary gift from the customer to you. We do not control, pool, allocate or make deductions from such tips, and we may not be aware of them.
    </p>

    <p class="clause">
      <span class="clause-number">15.3</span> You are responsible for understanding and meeting any personal tax obligations relating to tips you receive.
    </p>
  </div>

  <div class="contract-section">
    <h2 class="section-title">16. General</h2>

    <p class="clause">
      <span class="clause-number">16.1</span> This agreement is governed by the law of England and Wales.
    </p>

    <p class="clause">
      <span class="clause-number">16.2</span> If any clause is found unlawful or unenforceable, the remaining clauses will continue to apply.
    </p>
  </div>

  <div class="contract-section">
    <div class="signature-grid">
      <div class="signature-block">
        <div class="signature-label">Signed for and on behalf of ${escapeHtml(COMPANY_DETAILS.legalName)} (t/a ${escapeHtml(COMPANY_DETAILS.tradingName)}):</div>
        <div class="signature-row"><span class="signature-row-label">Name:</span><span class="signature-row-line"></span></div>
        <div class="signature-row"><span class="signature-row-label">Position:</span><span class="signature-row-line"></span></div>
        <div class="signature-row"><span class="signature-row-label">Date:</span><span class="signature-row-line"></span></div>
      </div>

      <div class="signature-block">
        <div class="signature-label">Worker:</div>
        <div class="signature-row"><span class="signature-row-label">Name:</span><span class="signature-row-line"></span></div>
        <div class="signature-row"><span class="signature-row-label">Date:</span><span class="signature-row-line"></span></div>
      </div>
    </div>
  </div>
</body>
</html>`
}

