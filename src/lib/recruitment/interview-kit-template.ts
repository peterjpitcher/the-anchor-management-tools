function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, character => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;',
  }[character] ?? character))
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.map(item => String(item).trim()).filter(Boolean)
}

function candidateName(candidate: any) {
  return [candidate?.first_name, candidate?.last_name].filter(Boolean).join(' ') || candidate?.email || 'Candidate'
}

function titleCase(value: string | null | undefined) {
  if (!value) return ''
  return value
    .replaceAll('_', ' ')
    .split(' ')
    .filter(Boolean)
    .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ')
}

function textValue(value: unknown, fallback: string) {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback
}

function htmlList(items: string[], fallback: string) {
  const safeItems = items.length > 0 ? items : [fallback]
  return safeItems.map(item => `<li>${escapeHtml(item)}</li>`).join('')
}

function recommendationGloss(value: string | null | undefined) {
  switch (value) {
    case 'recommend':
      return 'Strong signs on paper. Confirm availability, attitude and practical fit.'
    case 'reject':
      return 'Weak fit on paper. Only continue if new context changes the picture.'
    default:
      return 'A promising hospitality background with gaps worth probing. Worth meeting.'
  }
}

function formatInterviewDate(value: string | null | undefined) {
  if (!value) return 'To be confirmed'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'To be confirmed'
  return new Intl.DateTimeFormat('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Europe/London',
  }).format(date)
}

function extractedProfile(candidate: any): Record<string, unknown> | null {
  const data = candidate?.extracted_data
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null
  if ('extraction_error' in data) return null
  return data as Record<string, unknown>
}

function profileArray(candidate: any, key: string): string[] {
  return asStringArray(extractedProfile(candidate)?.[key])
}

function focusText(flags: string[], concerns: string[], role: string) {
  const focusItems = [...flags, ...concerns].slice(0, 3)
  if (focusItems.length === 0) {
    return `From the screening, steer the conversation around ${role.toLowerCase()} fit, availability and customer handling under pressure.`
  }
  return `From the screening, steer the conversation around ${focusItems.join(', ').toLowerCase()}.`
}

export function sanitizeRecruitmentKitFilename(value: string, fallback: string) {
  const cleaned = value
    .trim()
    .replace(/[^\w.-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120)
  return cleaned || fallback
}

export function generateRecruitmentInterviewKitHtml(input: {
  application: any
  appointment?: any | null
  cvText?: string | null
  logoUrl: string
}) {
  const application = input.application ?? {}
  const candidate = application.candidate ?? {}
  const posting = application.job_posting ?? {}
  const name = candidateName(candidate)
  const role = textValue(posting.title, 'General recruitment')
  const interviewDate = formatInterviewDate(input.appointment?.scheduled_start)
  const location = textValue(input.appointment?.location, 'The Anchor')
  const score = typeof application.ai_score === 'number' ? Math.max(0, Math.min(100, Math.round(application.ai_score))) : null
  const recommendation = titleCase(application.ai_recommendation) || 'Review'
  const rationale = textValue(application.ai_rationale, 'No rationale recorded.')
  const strengths = asStringArray(application.ai_strengths).length > 0
    ? asStringArray(application.ai_strengths)
    : profileArray(candidate, 'strengths')
  const concerns = asStringArray(application.ai_concerns).length > 0
    ? asStringArray(application.ai_concerns)
    : profileArray(candidate, 'concerns')
  const flags = asStringArray(application.ai_flags)
  const cvText = typeof input.cvText === 'string' && input.cvText.trim() ? input.cvText.trim() : null
  const cvSection = cvText
    ? `<section class="page-break" data-screen-label="CV copy">
        <h2 class="sec"><span class="num">05</span> CV copy</h2>
        <p class="sec-lead">A printable text copy of the uploaded CV. Keep this with the interview notes.</p>
        <pre class="cv-copy">${escapeHtml(cvText)}</pre>
      </section>`
    : ''

  return `<!doctype html>
<html lang="en-GB">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(`Interview Kit - ${name} - The Anchor`)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Clicker+Script&family=DM+Serif+Display:ital@0;1&family=Outfit:wght@300;400;500;600;700;800&display=swap" rel="stylesheet">
<style>
  :root {
    --anchor-green: #111111;
    --anchor-green-light: #222222;
    --anchor-green-deep: #111111;
    --anchor-gold: #666666;
    --anchor-gold-dark: #333333;
    --anchor-gold-bright: #777777;
    --anchor-charcoal: #111111;
    --anchor-cream: #ffffff;
    --anchor-white: #ffffff;
    --anchor-sand: #eeeeee;
    --border: #d9d9d9;
    --border-strong: #777777;
    --border-gold: #999999;
    --text-muted: #555555;
    --anchor-danger: #111111;
    --font-display: "DM Serif Display", Georgia, serif;
    --font-body: "Outfit", Arial, sans-serif;
    --font-script: "Clicker Script", cursive;
    --tracking-kicker: 0.18em;
    --rule: #555555;
    --row: 2.25rem;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    background: #f2f2f2;
    color: var(--anchor-charcoal);
    font-family: var(--font-body);
    font-size: 15px;
    line-height: 1.6;
    -webkit-font-smoothing: antialiased;
  }
  .doc {
    box-sizing: border-box;
    max-width: 8.5in;
    margin: 24px auto;
    background: var(--anchor-cream);
    padding: 0.45in 0.7in;
    box-shadow: 0 12px 40px rgba(0, 0, 0, 0.16);
  }
  .toolbar {
    position: sticky; top: 0; z-index: 50;
    display: flex; align-items: center; justify-content: space-between;
    gap: 16px; max-width: 8.5in; margin: 24px auto -8px;
    padding: 12px 18px; background: var(--anchor-green-deep);
    color: #ffffff; border-radius: 12px;
  }
  .tb-label {
    font-size: 13px; letter-spacing: 0.16em; text-transform: uppercase;
    color: var(--anchor-gold-bright); font-weight: 600;
  }
  .btn-print {
    appearance: none; border: 0; cursor: pointer; text-decoration: none;
    font-family: var(--font-body); font-weight: 600; font-size: 14px;
    color: var(--anchor-charcoal); background: var(--anchor-gold);
    padding: 10px 22px; border-radius: 999px;
    box-shadow: 0 4px 16px rgba(0,0,0,.25);
  }
  .masthead { padding: 8px 0 10px; border-bottom: 2px solid var(--anchor-green); margin-bottom: 10px; }
  .masthead-top { display: flex; align-items: flex-start; justify-content: space-between; gap: 24px; }
  .masthead img { height: 42px; width: auto; }
  .meta-doc { text-align: right; font-size: 12px; line-height: 1.5; color: var(--text-muted); }
  .kicker {
    font-family: var(--font-body); font-weight: 600; text-transform: uppercase;
    letter-spacing: var(--tracking-kicker); color: var(--anchor-gold-dark); font-size: 12px;
  }
  h1.cover-title {
    font-family: var(--font-display); font-weight: 400;
    font-size: clamp(1.8rem, 4.5vw, 2.2rem); line-height: 1.02;
    letter-spacing: -0.02em; color: var(--anchor-green);
    margin: 6px 0 2px;
  }
  .cover-sub { font-family: var(--font-script); color: var(--anchor-gold-dark); font-size: 1.2rem; line-height: 1; margin: 0; }
  .facts {
    display: grid; grid-template-columns: repeat(3, 1fr);
    gap: 1px; background: var(--border); border: 1px solid var(--border);
    border-radius: 10px; overflow: hidden; margin-top: 10px;
  }
  .fact { background: var(--anchor-cream); padding: 6px 14px; }
  .lbl { font-size: 10.5px; letter-spacing: 0.14em; text-transform: uppercase; color: var(--text-muted); font-weight: 600; margin-bottom: 3px; }
  .val { font-family: var(--font-display); font-size: 1.02rem; color: var(--anchor-green); line-height: 1.15; }
  h2.sec {
    font-family: var(--font-display); font-weight: 400; font-size: 1.4rem;
    color: var(--anchor-green); letter-spacing: -0.01em;
    margin: 14px 0 2px; display: flex; align-items: baseline; gap: 10px;
  }
  h2.sec .num {
    font-family: var(--font-body); font-weight: 700; font-size: 0.85rem;
    color: var(--anchor-gold-dark); letter-spacing: 0.1em;
  }
  .sec-lead { color: var(--text-muted); font-size: 13.5px; margin: 0 0 8px; }
  .sec-rule { height: 2px; background: var(--anchor-gold); width: 46px; border-radius: 2px; margin: 8px 0 18px; }
  .screen {
    background: var(--anchor-white); color: var(--anchor-charcoal);
    border: 1px solid var(--border); border-top: 4px solid var(--anchor-gold);
    border-radius: 12px; padding: 13px 18px; margin-top: 4px;
  }
  .screen-head { display: flex; align-items: center; gap: 20px; }
  .score-ring {
    flex: none; width: 68px; height: 68px; border-radius: 999px;
    display: grid; place-items: center; text-align: center;
    border: 3px solid var(--anchor-gold); background: var(--anchor-cream);
  }
  .score-ring .n { font-family: var(--font-display); font-size: 1.35rem; color: var(--anchor-green); line-height: 1; }
  .score-ring .of { font-size: 9px; letter-spacing: 0.12em; color: var(--text-muted); text-transform: uppercase; }
  .reco-block { flex: 1; }
  .reco-label { font-size: 11px; letter-spacing: 0.16em; text-transform: uppercase; color: var(--text-muted); margin-bottom: 6px; }
  .reco-pill {
    display: inline-block; font-weight: 600; font-size: 13px;
    padding: 5px 14px; border-radius: 999px;
    background: var(--anchor-sand); color: var(--anchor-gold-dark);
    border: 1px solid var(--border-gold); text-transform: capitalize;
  }
  .rationale {
    margin: 10px 0 0; padding-top: 10px; border-top: 1px solid var(--border);
    font-size: 11.8px; line-height: 1.45; color: var(--anchor-charcoal);
  }
  .rl-label {
    display: block; font-size: 11px; letter-spacing: 0.16em; text-transform: uppercase;
    color: var(--anchor-gold-dark); margin-bottom: 6px; font-weight: 600;
  }
  .sc-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-top: 8px; }
  .sc-card { background: var(--anchor-white); border: 1px solid var(--border); border-radius: 10px; padding: 8px 13px; }
  .sc-card.flags { grid-column: 1 / -1; }
  .sc-card h3 {
    margin: 0 0 5px; font-family: var(--font-body); font-size: 12px;
    letter-spacing: 0.12em; text-transform: uppercase; font-weight: 700;
  }
  .sc-card.str h3 { color: var(--anchor-green-light); }
  .sc-card.con h3 { color: var(--anchor-gold-dark); }
  .sc-card.flags h3 { color: var(--anchor-danger); }
  .sc-card ul { margin: 0; padding: 0; list-style: none; }
  .sc-card li { position: relative; padding-left: 18px; font-size: 12px; margin-bottom: 3px; line-height: 1.3; }
  .sc-card li:last-child { margin-bottom: 0; }
  .sc-card li::before {
    content: ""; position: absolute; left: 0; top: 8px;
    width: 7px; height: 7px; border-radius: 2px;
  }
  .sc-card.str li::before { background: var(--anchor-green-light); }
  .sc-card.con li::before { background: var(--anchor-gold); }
  .sc-card.flags li::before { background: var(--anchor-danger); transform: rotate(45deg); border-radius: 1px; }
  .callout {
    display: flex; gap: 12px; align-items: flex-start;
    background: var(--anchor-white); border: 1px solid var(--border-gold);
    border-radius: 10px; padding: 9px 13px;
    margin-top: 8px; font-size: 12.5px;
  }
  .tag {
    flex: none; font-size: 10.5px; letter-spacing: 0.12em; text-transform: uppercase;
    font-weight: 700; color: var(--anchor-charcoal);
    background: var(--anchor-gold); border-radius: 999px; padding: 4px 11px; margin-top: 1px;
  }
  .field-label {
    font-weight: 600; color: var(--anchor-green); font-size: 14.5px;
    margin: 18px 0 8px; line-height: 1.4;
  }
  .q-no { color: var(--anchor-gold-dark); font-weight: 700; margin-right: 4px; }
  .sub-note { font-weight: 400; color: var(--text-muted); font-size: 12.5px; }
  .lines {
    background-image: repeating-linear-gradient(
      to bottom,
      transparent 0, transparent calc(var(--row) - 1px),
      var(--rule) calc(var(--row) - 1px), var(--rule) var(--row)
    );
  }
  .lines.l2 { height: calc(var(--row) * 2); }
  .lines.l4 { height: calc(var(--row) * 4); }
  .inline-fields { display: grid; grid-template-columns: 1.3fr 1fr; gap: 22px; margin: 4px 0 8px; }
  .ff { display: flex; align-items: flex-end; gap: 10px; }
  .ff-label { font-weight: 600; color: var(--anchor-green); font-size: 14px; white-space: nowrap; }
  .ff-line { flex: 1; border-bottom: 1px solid var(--rule); height: 1.9rem; }
  .cert { background: var(--anchor-white); border: 1px solid var(--border); border-radius: 10px; padding: 14px 18px; margin-top: 8px; }
  .cert-row { display: flex; align-items: center; gap: 12px; padding: 9px 0; border-bottom: 1px dashed var(--border); }
  .cert-row:last-child { border-bottom: 0; }
  .cert-name { font-weight: 600; font-size: 14px; min-width: 130px; color: var(--anchor-charcoal); }
  .yn { display: inline-flex; gap: 6px; }
  .opt {
    border: 1.5px solid var(--border-strong); border-radius: 999px;
    min-width: 30px; height: 26px; display: inline-grid; place-items: center;
    padding: 0 10px; font-size: 12px; font-weight: 600; color: var(--text-muted);
  }
  .exp { flex: 1; display: flex; align-items: flex-end; gap: 8px; }
  .exp .lbl { font-size: 12.5px; color: var(--text-muted); white-space: nowrap; }
  .ln { flex: 1; border-bottom: 1px solid var(--rule); height: 1.5rem; }
  .role-pick { display: flex; gap: 8px; margin: 6px 0 8px; flex-wrap: wrap; }
  .opt-pill {
    border: 1.5px solid var(--border-strong); border-radius: 999px;
    padding: 5px 18px; font-size: 12.5px; font-weight: 600; color: var(--text-muted);
  }
  ol.situational { margin: 0; padding: 0; list-style: none; counter-reset: s; }
  ol.situational > li { counter-increment: s; margin-bottom: 16px; }
  ol.situational > li .q {
    display: flex; gap: 10px; font-weight: 500; color: var(--anchor-charcoal);
    font-size: 14px; margin-bottom: 7px; line-height: 1.4;
  }
  ol.situational > li .q::before {
    content: counter(s); flex: none;
    width: 22px; height: 22px; border-radius: 999px; display: grid; place-items: center;
    background: var(--anchor-sand); color: var(--anchor-gold-dark); font-weight: 700; font-size: 12px;
    margin-top: 1px;
  }
  .decision {
    background: var(--anchor-white); color: var(--anchor-charcoal);
    border: 1px solid var(--border); border-top: 4px solid var(--anchor-gold);
    border-radius: 12px; padding: 22px 24px; margin-top: 8px;
  }
  .decision h2.sec { margin-top: 0; }
  .signoff { display: grid; grid-template-columns: 1fr 1fr; gap: 22px 28px; margin-top: 20px; }
  .cv-copy {
    white-space: pre-wrap;
    font: 11px/1.45 var(--font-body);
    background: var(--anchor-white);
    border: 1px solid var(--border);
    border-top: 4px solid var(--anchor-gold);
    border-radius: 12px;
    padding: 18px;
  }
  .doc-footer-note {
    margin: 34px 0 4px; padding-top: 14px; border-top: 1px solid var(--border);
    font-size: 11px; color: var(--text-muted); display: flex; justify-content: space-between; gap: 16px;
  }
  @page { size: letter; margin: 0; }
  @media print {
    html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    html, body { margin: 0; padding: 0; background: #fff; }
    .doc { max-width: none !important; margin: 0 !important; padding: 0.45in 0.7in !important; box-shadow: none !important; background: #fff; }
    .screen-only { display: none !important; }
    h2.sec, .field-label, h3 { break-after: avoid; }
    .sc-card, .cert, .callout, .decision, .cert-row, li { break-inside: avoid; }
    .page-break { break-before: page; }
  }
</style>
</head>
<body>
  <div class="toolbar screen-only">
    <span class="tb-label">The Anchor - Recruitment</span>
    <button class="btn-print" onclick="window.print()">Print</button>
  </div>

  <main class="doc">
        <header class="masthead" data-screen-label="Cover">
          <div class="masthead-top">
            <img src="${escapeHtml(input.logoUrl)}" alt="The Anchor, Stanwell Moor Village">
            <div class="meta-doc">Interview Kit<br>Generated for interview use<br>Confidential - recruitment</div>
          </div>
          <p class="kicker" style="margin-top:12px;">Candidate Interview Kit</p>
          <h1 class="cover-title">${escapeHtml(name)}</h1>
          <p class="cover-sub">${escapeHtml(role)}</p>
          <div class="facts">
            <div class="fact"><div class="lbl">Role</div><div class="val">${escapeHtml(role)}</div></div>
            <div class="fact"><div class="lbl">Interview date</div><div class="val">${escapeHtml(interviewDate)}</div></div>
            <div class="fact"><div class="lbl">Location</div><div class="val">${escapeHtml(location)}</div></div>
          </div>
        </header>

        <section data-screen-label="Screening summary">
          <h2 class="sec"><span class="num">01</span> Screening summary</h2>
          <p class="sec-lead">An at-a-glance read of the candidate's application before you meet them. Use it to steer the conversation, not to decide it.</p>
          <div class="screen">
            <div class="screen-head">
              <div class="score-ring" aria-label="AI score ${escapeHtml(score === null ? 'not scored' : `${score} out of 100`)}">
                <div><div class="n">${escapeHtml(score === null ? '-' : String(score))}</div><div class="of">/ 100</div></div>
              </div>
              <div class="reco-block">
                <div class="reco-label">AI recommendation</div>
                <span class="reco-pill">${escapeHtml(recommendation)}</span>
                <p style="margin:10px 0 0; font-size:12.5px; color:var(--text-muted); line-height:1.5;">${escapeHtml(recommendationGloss(application.ai_recommendation))}</p>
              </div>
            </div>
            <p class="rationale"><span class="rl-label">Rationale</span>${escapeHtml(rationale)}</p>
          </div>
          <div class="sc-grid">
            <div class="sc-card str"><h3>Strengths</h3><ul>${htmlList(strengths, 'None recorded')}</ul></div>
            <div class="sc-card con"><h3>Concerns</h3><ul>${htmlList(concerns, 'None recorded')}</ul></div>
            <div class="sc-card flags"><h3>Flags to address</h3><ul>${htmlList(flags, 'None recorded')}</ul></div>
          </div>
          <div class="callout"><span class="tag">Right to work</span><div>Remind the candidate to bring proof of their right to work in the UK to the interview. Check and record it before any offer.</div></div>
        </section>

        <section class="page-break" data-screen-label="Interview">
          <h2 class="sec"><span class="num">02</span> Interview</h2>
          <div class="sec-rule"></div>
          <div class="callout" style="margin-top:0; margin-bottom:18px;"><span class="tag">Focus</span><div>${escapeHtml(focusText(flags, concerns, role))}</div></div>
          <div class="inline-fields">
            <div class="ff"><span class="ff-label">Name:</span><span class="ff-line"></span></div>
            <div class="ff"><span class="ff-label">Date of interview:</span><span class="ff-line"></span></div>
          </div>
          <p class="field-label">What experience do you have that would be relevant here at The Anchor?</p><div class="lines l4"></div>
          <p class="field-label" style="margin-top:24px;">Questions</p>
          <p class="field-label"><span class="q-no">1.</span>Are you interested in working the bar, the kitchen, or both? What experience do you have in each?</p>
          <div class="role-pick"><span class="opt-pill">Bar</span><span class="opt-pill">Kitchen</span><span class="opt-pill">Both</span></div><div class="lines l2"></div>
          <p class="field-label"><span class="q-no">2.</span>What experience do you have with handling cash?</p><div class="lines l2"></div>
          <p class="field-label"><span class="q-no">3.</span>How do you feel about working evenings or weekends?</p><div class="lines l2"></div>
          <p class="field-label"><span class="q-no">4.</span>We are one team here at The Anchor. How well do you work with other people?</p><div class="lines l2"></div>
          <p class="field-label"><span class="q-no">5.</span>Do you have any experience working with food?</p><div class="lines l2"></div>
          <p class="field-label"><span class="q-no">6.</span>Would you be interested in shifts in our kitchen?</p><div class="lines l2"></div>
          <p class="field-label"><span class="q-no">7.</span>Do you have any relevant certification?</p>
          <div class="cert">
            <div class="cert-row"><span class="cert-name">Food Hygiene</span><span class="yn"><span class="opt">Yes</span><span class="opt">No</span></span><span class="exp"><span class="lbl">Expiration:</span><span class="ln"></span></span></div>
            <div class="cert-row"><span class="cert-name">Personal Licence</span><span class="yn"><span class="opt">Yes</span><span class="opt">No</span></span><span class="exp"><span class="lbl">Expiration:</span><span class="ln"></span></span></div>
            <div class="cert-row"><span class="cert-name">Other</span><span class="exp"><span class="ln"></span></span></div>
          </div>
          <div class="lines l2"></div>
          <p class="field-label" style="margin-top:22px;"><span class="q-no">8.</span>What does your availability look like?</p><div class="lines l2"></div>
          <p class="field-label"><span class="q-no">9.</span>Could we contact you about short notice shifts in the event of sickness?</p><div class="lines l2"></div>
          <p class="field-label"><span class="q-no">10.</span>We pay monthly and to the national living wage. Will that cause you any issues?</p><div class="lines l2"></div>
          <p class="field-label"><span class="q-no">11.</span>We understand that our team have other jobs. What hours do you work normally, so that we don't impact on your other job(s)?</p><div class="lines l2"></div>
          <p class="field-label"><span class="q-no">12.</span>Do you work at any pubs within a 5 mile radius of The Anchor?</p><div class="lines l2"></div>
        </section>

        <section class="page-break" data-screen-label="Situational questions">
          <h2 class="sec"><span class="num">03</span> Optional situational questions</h2>
          <p class="sec-lead">Use any of these to explore judgement and how the candidate thinks on their feet.</p>
          <ol class="situational">
            <li><div class="q">A customer drops a glass during service. What do you do?</div><div class="lines l2"></div></li>
            <li><div class="q">A customer tells you that someone is unwell outside. What do you do?</div><div class="lines l2"></div></li>
            <li><div class="q">You see a colleague giving away free drinks to a friend. What do you do?</div><div class="lines l2"></div></li>
            <li><div class="q">You're hungry during service and don't finish for another 3 hours. What do you do?</div><div class="lines l2"></div></li>
            <li><div class="q">An intoxicated customer pays £20 for a drink and leaves before you can give them their change. What do you do?</div><div class="lines l2"></div></li>
            <li><div class="q">A customer says that they didn't enjoy their meal. What do you do?</div><div class="lines l2"></div></li>
            <li><div class="q">You see a customer topping up their soft drinks from a personal flask. What do you do?</div><div class="lines l2"></div></li>
            <li><div class="q">You're working the bar and see that the kitchen is very busy. What do you do?</div><div class="lines l2"></div></li>
          </ol>
          <p class="field-label" style="margin-top:26px;">Do you have any questions for me? <span class="sub-note">(list below any that are asked)</span></p>
          <div class="lines l4"></div>
        </section>

        <section data-screen-label="Decision">
          <div class="decision">
            <h2 class="sec"><span class="num" style="color:var(--anchor-gold-bright);">04</span> Decision notes</h2>
            <p class="sec-lead">Capture your overall impression, next steps and anything to follow up.</p>
            <div class="lines l4"></div>
            <div class="signoff">
              <div class="ff"><span class="ff-label">Interviewer:</span><span class="ff-line"></span></div>
              <div class="ff"><span class="ff-label">Date:</span><span class="ff-line"></span></div>
              <div class="ff"><span class="ff-label">Outcome:</span><span class="ff-line"></span></div>
              <div class="ff"><span class="ff-label">Signature:</span><span class="ff-line"></span></div>
            </div>
          </div>
        </section>

        ${cvSection}

        <div class="doc-footer-note"><span>The Anchor - Stanwell Moor Village - A village pub since 1751</span><span>Where Everyone's Welcome</span></div>
  </main>
</body>
</html>`
}
