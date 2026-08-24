import { RECRUITMENT_TRIAL_DRESS_CODE } from '@/lib/recruitment/contact'

/**
 * Trial brief, printed on UK A4.
 *
 * This used to be a plain-text dump rendered into a pop-up window as a single
 * `<pre>`, which is why it never printed sensibly. It is now a real PDF with the
 * same page geometry as the interview kit: `@page { size: A4 }` with the margins
 * carried by the document body rather than by the print dialog.
 */

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, character => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[character] ?? character))
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.map(item => String(item).trim()).filter(Boolean)
}

function candidateName(candidate: any) {
  return [candidate?.first_name, candidate?.last_name].filter(Boolean).join(' ') || candidate?.email || 'Candidate'
}

function htmlList(items: string[], fallback: string) {
  const safeItems = items.length > 0 ? items : [fallback]
  return safeItems.map(item => `<li>${escapeHtml(item)}</li>`).join('')
}

function formatTrialDate(value: string | null | undefined) {
  if (!value) return 'To be confirmed'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'To be confirmed'
  return new Intl.DateTimeFormat('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hourCycle: 'h12',
    timeZone: 'Europe/London',
  }).format(date)
}

const DRESS_CODE_ITEMS = RECRUITMENT_TRIAL_DRESS_CODE
  .split('\n')
  .filter(line => line.startsWith('- '))
  .map(line => line.slice(2))

export function generateRecruitmentTrialBriefHtml(input: {
  application: any
  appointment?: any | null
  logoUrl: string
}) {
  const application = input.application ?? {}
  const candidate = application.candidate ?? {}
  const posting = application.job_posting ?? {}
  const name = candidateName(candidate)
  const role = posting.title || 'General recruitment'
  const when = formatTrialDate(input.appointment?.scheduled_start)
  const where = input.appointment?.location || 'The Anchor'
  const strengths = asStringArray(application.ai_strengths)
  const concerns = asStringArray(application.ai_concerns)
  const score = typeof application.ai_score === 'number' ? `${application.ai_score} out of 100` : 'Not scored'

  return `<!doctype html>
<html lang="en-GB">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(`Trial Brief - ${name} - The Anchor`)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=DM+Serif+Display&family=Outfit:wght@300;400;500;600;700&display=swap" rel="stylesheet">
<style>
  :root {
    --ink: #1f2933;
    --muted: #6b7280;
    --line: #d8d5cc;
    --accent: #111111;
    --gold: #666666;
    --cream: #fbfaf7;
    --row: 2.25rem;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; background: #f2f2f2; color: var(--ink);
    font-family: Outfit, Arial, sans-serif; font-size: 15px; line-height: 1.6;
    -webkit-font-smoothing: antialiased;
  }
  .toolbar {
    display: flex; align-items: center; justify-content: space-between; gap: 16px;
    max-width: 210mm; margin: 24px auto -8px; padding: 12px 18px;
    background: var(--accent); color: #fff; border-radius: 12px;
  }
  .tb-label { font-size: 13px; letter-spacing: 0.16em; text-transform: uppercase; font-weight: 600; }
  .btn-print {
    appearance: none; border: 0; cursor: pointer; font-weight: 600; font-size: 14px;
    color: var(--ink); background: #e5e2d8; padding: 10px 22px; border-radius: 999px;
  }
  .doc {
    max-width: 210mm; margin: 24px auto; background: var(--cream);
    padding: 12mm 16mm; box-shadow: 0 12px 40px rgba(0,0,0,0.16);
  }
  .masthead { padding: 8px 0 10px; border-bottom: 2px solid var(--accent); margin-bottom: 18px; }
  .masthead-top { display: flex; align-items: flex-start; justify-content: space-between; gap: 24px; }
  .masthead img { height: 42px; width: auto; }
  .meta-doc { text-align: right; font-size: 12px; line-height: 1.5; color: var(--muted); }
  .kicker {
    font-weight: 600; text-transform: uppercase; letter-spacing: 0.18em;
    color: var(--gold); font-size: 12px; margin: 0 0 4px;
  }
  h1 { font-family: 'DM Serif Display', Georgia, serif; font-weight: 400; font-size: 2rem; line-height: 1.05; margin: 0 0 4px; }
  .facts { display: grid; grid-template-columns: repeat(3, 1fr); gap: 14px; margin: 18px 0 8px; }
  .lbl { font-size: 10.5px; letter-spacing: 0.14em; text-transform: uppercase; color: var(--muted); font-weight: 600; margin-bottom: 3px; }
  .val { font-family: 'DM Serif Display', Georgia, serif; font-size: 1.02rem; line-height: 1.2; }
  h2.sec {
    font-family: 'DM Serif Display', Georgia, serif; font-weight: 400; font-size: 1.4rem;
    margin: 26px 0 2px; display: flex; align-items: baseline; gap: 10px;
  }
  h2.sec .num { font-family: Outfit, Arial, sans-serif; font-weight: 700; font-size: 0.85rem; color: var(--gold); }
  .sec-lead { color: var(--muted); font-size: 13.5px; margin: 0 0 8px; }
  .sec-rule { height: 2px; background: var(--gold); width: 46px; border-radius: 2px; margin: 8px 0 16px; }
  .cards { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
  .card { border: 1px solid var(--line); border-radius: 10px; padding: 12px 14px; background: #fff; }
  .card h3 { margin: 0 0 6px; font-size: 12px; letter-spacing: 0.14em; text-transform: uppercase; color: var(--muted); }
  .card ul { margin: 0; padding-left: 18px; }
  .card li { font-size: 12.5px; margin-bottom: 3px; line-height: 1.35; }
  .callout { border: 1px solid var(--line); border-left: 4px solid var(--accent); border-radius: 8px; padding: 12px 14px; background: #fff; margin: 12px 0; }
  .callout p { margin: 0 0 6px; }
  .callout ul { margin: 4px 0 0; padding-left: 18px; }
  .callout li { margin-bottom: 3px; }
  ol.watch { margin: 0; padding-left: 20px; }
  ol.watch li { margin-bottom: 14px; }
  .q { font-weight: 600; margin-bottom: 4px; }
  .lines { background-image: repeating-linear-gradient(to bottom, transparent, transparent calc(var(--row) - 1px), var(--line) calc(var(--row) - 1px), var(--line) var(--row)); }
  .lines.l2 { height: calc(var(--row) * 2); }
  .lines.l4 { height: calc(var(--row) * 4); }
  .signoff { display: grid; grid-template-columns: 1fr 1fr; gap: 12px 24px; margin-top: 18px; }
  .ff { display: flex; align-items: baseline; gap: 8px; }
  .ff-label { font-weight: 600; font-size: 14px; white-space: nowrap; }
  .ff-line { flex: 1; border-bottom: 1px solid var(--line); height: 1.4rem; }
  @page { size: A4; margin: 14mm 16mm 18mm; }
  @media print {
    html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    html, body { margin: 0; padding: 0; background: #fff; }
    .doc { max-width: none !important; margin: 0 !important; padding: 0 !important; box-shadow: none !important; background: #fff; }
    .screen-only { display: none !important; }
    h2.sec, .card h3, .sec-lead, .sec-rule, .q { break-after: avoid; page-break-after: avoid; }
    .card, .callout, li, .lines { break-inside: avoid; page-break-inside: avoid; }
  }
</style>
</head>
<body>
  <div class="toolbar screen-only">
    <span class="tb-label">The Anchor - Recruitment</span>
    <button class="btn-print" onclick="window.print()">Print</button>
  </div>

  <main class="doc">
    <header class="masthead">
      <div class="masthead-top">
        <img src="${escapeHtml(input.logoUrl)}" alt="The Anchor, Stanwell Moor Village">
        <div class="meta-doc">Trial Brief<br>Generated for trial use<br>Confidential - recruitment</div>
      </div>
    </header>

    <p class="kicker">Trial shift</p>
    <h1>${escapeHtml(name)}</h1>

    <div class="facts">
      <div><div class="lbl">Role</div><div class="val">${escapeHtml(role)}</div></div>
      <div><div class="lbl">When</div><div class="val">${escapeHtml(when)}</div></div>
      <div><div class="lbl">Where</div><div class="val">${escapeHtml(where)}</div></div>
    </div>

    <h2 class="sec"><span class="num">01</span> How the trial runs</h2>
    <div class="sec-rule"></div>
    <div class="callout">
      <p>Two hours, paired with an existing team member, with a quick briefing before and a short debrief after. The briefing and debrief are with Billy, the General Manager.</p>
      <p>The trial is unpaid. They get a complimentary main-menu item and a soft drink afterwards.</p>
    </div>
    <div class="callout">
      <p><strong>Right to work.</strong> Check original, valid proof before any work-like duties begin. No proof, no trial.</p>
    </div>
    <div class="callout">
      <p><strong>What they were told to wear.</strong> If they have turned up in something else, note it below rather than sending them home.</p>
      <ul>${htmlList(DRESS_CODE_ITEMS, 'Smart, plain, closed-toe')}</ul>
    </div>

    <h2 class="sec"><span class="num">02</span> From the application</h2>
    <p class="sec-lead">AI score: ${escapeHtml(score)}. Use this as background, not as a verdict.</p>
    <div class="sec-rule"></div>
    <div class="cards">
      <div class="card"><h3>Strengths</h3><ul>${htmlList(strengths, 'None recorded')}</ul></div>
      <div class="card"><h3>Watch for</h3><ul>${htmlList(concerns, 'None recorded')}</ul></div>
    </div>

    <h2 class="sec"><span class="num">03</span> What to watch on the shift</h2>
    <p class="sec-lead">Score what you actually see, not what the CV claims.</p>
    <div class="sec-rule"></div>
    <ol class="watch">
      <li><div class="q">Did they greet customers first, without being prompted?</div><div class="lines l2"></div></li>
      <li><div class="q">How did they handle being told they had got something wrong?</div><div class="lines l2"></div></li>
      <li><div class="q">Did they keep the bar clean and tidy without being asked?</div><div class="lines l2"></div></li>
      <li><div class="q">What did they do when it went quiet?</div><div class="lines l2"></div></li>
      <li><div class="q">Would the team member they shadowed want them on a busy Friday?</div><div class="lines l2"></div></li>
    </ol>

    <h2 class="sec"><span class="num">04</span> Decision notes</h2>
    <p class="sec-lead">Capture your overall impression, next steps and anything to follow up.</p>
    <div class="sec-rule"></div>
    <div class="lines l4"></div>
    <div class="signoff">
      <div class="ff"><span class="ff-label">Supervised by:</span><span class="ff-line"></span></div>
      <div class="ff"><span class="ff-label">Date:</span><span class="ff-line"></span></div>
      <div class="ff"><span class="ff-label">Outcome:</span><span class="ff-line"></span></div>
      <div class="ff"><span class="ff-label">Signature:</span><span class="ff-line"></span></div>
    </div>
  </main>
</body>
</html>`
}
