// Zero-hours casual worker agreement — print-ready A4 template. Structure/CSS
// were adapted from the design handoff; clause copy is now maintained here by
// the business and has been amended beyond the original handoff. Per-worker
// values are merged via the AgreementFields object; the Young Worker Schedule
// (page 11) is appended only when data.includeYoungWorkerSchedule is true.
import type { WorkerAgreementData } from './worker-agreement'

interface AgreementFields {
  year: string
  initials: string
  agreementDate: string
  workerName: string
  workerAddress: string
  dobLine: string
  jobTitle: string
  startDate: string
  hourlyRate: string
  nmwBand: string
  youngWorker: string
  managerName: string
  managerEmail: string
}

function esc(value: string): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/** Merged value as finished text, or a blank fill-in line when empty. */
function field(value: string): string {
  const trimmed = (value ?? '').trim()
  return trimmed ? esc(trimmed) : '<span class="fill"></span>'
}

/** Rewrite the running-footer page number and total for one sheet. */
function numberSheet(sheet: string, pageNo: number, total: number): string {
  return sheet
    .replace(/(<b class="pageno">)\d+(<\/b>)/, `$1${pageNo}$2`)
    .replace(/(<b class="pagetot">)\d+(<\/b>)/, `$1${total}$2`)
}

const STYLE = `
  :root{
    --paper:#ffffff;
    --ink:#161616;
    --ink-soft:#363636;
    --ink-mute:#6b6b6b;
    --rule:#cfcfcf;

    --font-display:'DM Serif Display', Georgia, serif;
    --font-body:'Outfit', system-ui, -apple-system, sans-serif;
    --font-script:'Clicker Script', cursive;
  }

  *{ box-sizing:border-box; }
  html,body{ margin:0; padding:0; }
  body{
    background:#3a3a3a;
    font-family:var(--font-body);
    color:var(--ink);
    -webkit-print-color-adjust:exact; print-color-adjust:exact;
  }
  a{ color:#005131; text-decoration:none; }
  a:hover{ color:#8b6914; }

  /* ---------- screen scaffolding (hidden on print) ---------- */
  .screen-note{ color:#e9e4d8; font-size:13.5px; text-align:center; padding:24px 16px 4px; line-height:1.6; }
  .screen-note strong{ color:#fff; font-weight:600; }
  .screen-note .sub{ display:block; color:#b3ada1; font-size:12px; margin-top:5px; }
  .toolbar{ text-align:center; padding:6px 0 2px; }
  .print-btn{
    font-family:var(--font-body); font-weight:600; font-size:13px;
    color:#161616; background:#e9e4d8; border:0; border-radius:999px;
    padding:9px 22px; cursor:pointer; letter-spacing:.01em;
  }
  .print-btn:hover{ background:#fff; }
  .stage{ display:flex; flex-direction:column; align-items:center; gap:10mm; padding:22px 0 70px; }

  /* ---------- A4 sheet ---------- */
  .sheet{
    width:210mm; height:297mm; background:var(--paper);
    padding:11mm 12mm; position:relative; display:flex; flex-direction:column;
    overflow:hidden; box-shadow:0 16px 46px rgba(0,0,0,.42);
  }
  .sheet::after{ content:""; position:absolute; inset:5mm; border:1px solid var(--ink); pointer-events:none; z-index:1; }
  .sheet-inner{ position:relative; z-index:2; display:flex; flex-direction:column; height:100%; }

  /* ---------- running header (every page) ---------- */
  .run-head{ display:flex; align-items:flex-end; justify-content:space-between; gap:8mm; padding-bottom:2.2mm; border-bottom:1px solid var(--ink); }
  .run-head-logo{ height:8mm; width:auto; display:block; }
  .run-head-meta{ text-align:right; line-height:1.3; }
  .doc-kind{ display:block; font-family:var(--font-display); font-size:13px; color:var(--ink); line-height:1.05; letter-spacing:-.01em; }
  .doc-ref{ display:block; font-size:8.5px; letter-spacing:.12em; text-transform:uppercase; color:var(--ink-mute); margin-top:1.2mm; }
  .doc-ref b{ color:var(--ink-soft); font-weight:600; }

  /* ---------- body region ---------- */
  .body{ flex:1 1 auto; padding-top:3.6mm; min-height:0; }

  /* ---------- cover block ---------- */
  .cover-kicker{ font-weight:600; font-size:9px; letter-spacing:.22em; text-transform:uppercase; color:var(--ink-mute); margin:0 0 2.6mm; }
  .cover-title{ font-family:var(--font-display); font-weight:400; font-size:42px; line-height:1.03; color:var(--ink); letter-spacing:-.02em; margin:0 0 2.4mm; }
  .cover-script{ font-family:var(--font-script); font-size:24px; color:var(--ink-soft); line-height:1; margin:0 0 7mm; }

  .meta{ display:grid; grid-template-columns:repeat(3,1fr); border:1px solid var(--ink); margin:0 0 7mm; }
  .meta-cell{ padding:3.6mm 4.2mm; border-right:1px solid var(--rule); }
  .meta-cell:last-child{ border-right:0; }
  .meta-label{ font-weight:600; font-size:8.5px; letter-spacing:.14em; text-transform:uppercase; color:var(--ink-mute); margin:0 0 1.8mm; }
  .meta-value{ font-size:12.5px; font-weight:500; color:var(--ink); margin:0; line-height:1.3; }

  /* ---------- generic blocks ---------- */
  .section-label{ font-weight:700; font-size:10px; letter-spacing:.2em; text-transform:uppercase; color:var(--ink); margin:0 0 2.6mm; padding-bottom:1.4mm; border-bottom:1px solid var(--rule); }
  .lead{ font-size:13px; line-height:1.58; color:var(--ink-soft); margin:0 0 5mm; }
  .lead b{ color:var(--ink); font-weight:600; }

  /* parties on cover */
  .party{ display:flex; gap:5mm; margin:0 0 3.6mm; }
  .party-no{ font-family:var(--font-display); font-size:17px; line-height:1.1; color:var(--ink); flex-shrink:0; width:8mm; }
  .party-body{ font-size:13px; line-height:1.5; color:var(--ink-soft); margin:0; }
  .party-body b{ color:var(--ink); font-weight:600; }
  .party-body .role{ display:block; font-size:10.5px; letter-spacing:.14em; text-transform:uppercase; color:var(--ink-mute); font-weight:600; margin-bottom:1mm; }

  /* ---------- numbered clauses (auto 1 / 1.1 / a.) ---------- */
  ol.contract{ list-style:none; margin:0; padding:0; counter-reset:l1; }
  ol.contract > li{ counter-increment:l1; margin:0 0 2.9mm; }
  ol.contract > li:last-child{ margin-bottom:0; }
  .clause-h{ position:relative; padding-left:8.5mm; font-weight:700; font-size:12px; color:var(--ink); margin:0 0 1.3mm; line-height:1.2; }
  .clause-h::before{ content:counter(l1) "."; position:absolute; left:0; top:0; width:7.5mm; font-weight:700; }

  ol.sub{ list-style:none; margin:0; padding:0; counter-reset:l2; }
  ol.sub > li{ counter-increment:l2; position:relative; padding-left:9.5mm; font-size:10.9px; line-height:1.4; color:var(--ink-soft); margin:0 0 1mm; }
  ol.sub > li::before{ content:counter(l1) "." counter(l2); position:absolute; left:0; top:0; font-weight:600; color:var(--ink); }
  ol.sub > li:last-child{ margin-bottom:0; }
  ol.sub b{ color:var(--ink); font-weight:600; }

  ol.sub2{ list-style:none; margin:1mm 0 0.4mm; padding:0; counter-reset:l3; }
  ol.sub2 > li{ counter-increment:l3; position:relative; padding-left:7mm; font-size:10.9px; line-height:1.4; color:var(--ink-soft); margin:0 0 0.7mm; }
  ol.sub2 > li::before{ content:counter(l3, lower-alpha) "."; position:absolute; left:0; top:0; font-weight:600; color:var(--ink); }

  .clause-p{ padding-left:8.5mm; font-size:10.9px; line-height:1.4; color:var(--ink-soft); margin:0; }

  /* bullet mini-lists — inline compact */
  .mini-list{ list-style:none; margin:0.8mm 0 0.4mm; padding:0; display:flex; flex-wrap:wrap; gap:0.6mm 4mm; }
  .mini-list li{ position:relative; padding-left:5mm; font-size:10.9px; line-height:1.35; color:var(--ink-soft); }
  .mini-list li::before{ content:"—"; position:absolute; left:0; color:var(--ink-mute); }

  /* callout note */
  .note{ margin:3mm 0 0; padding:2.6mm 4mm; border-left:2px solid var(--ink); background:#f1eee7; font-size:11px; line-height:1.5; color:var(--ink-soft); }
  .note b{ color:var(--ink); font-weight:600; }

  /* internal-use note (grey) */
  .internal{ margin:3.4mm 0 0; padding:3mm 4mm; border:1px solid var(--ink); background:#f1eee7; }
  .internal-h{ font-weight:700; font-size:9px; letter-spacing:.16em; text-transform:uppercase; color:var(--ink); margin:0 0 1.6mm; }
  .internal-p{ font-size:11px; line-height:1.5; color:var(--ink-soft); margin:0; }
  .internal-p b{ color:var(--ink); font-weight:600; }

  /* ---------- placeholder field spans ---------- */
  .ph{ font-weight:600; color:var(--ink); background:#efeadf; border:1px solid #ddd4c2; border-radius:2px; padding:0 2px; font-style:normal; white-space:nowrap; }

  /* ---------- particulars table ---------- */
  .ptable{ width:100%; border-collapse:collapse; margin:0 0 3mm; }
  .ptable th, .ptable td{ border:1px solid var(--rule); padding:2.4mm 3mm; text-align:left; vertical-align:top; font-size:11px; line-height:1.4; color:var(--ink-soft); }
  .ptable th{ width:42%; font-weight:600; color:var(--ink); background:#faf8f3; }
  .ptable td b{ color:var(--ink); font-weight:600; }

  /* schedule intro */
  .sched-kicker{ font-weight:600; font-size:9px; letter-spacing:.2em; text-transform:uppercase; color:var(--ink-mute); margin:0 0 2mm; }
  .sched-title{ font-family:var(--font-display); font-weight:400; font-size:28px; line-height:1.05; color:var(--ink); letter-spacing:-.02em; margin:0 0 2.4mm; }
  .sched-lead{ font-size:12px; line-height:1.5; color:var(--ink-soft); margin:0 0 4mm; }
  .sched-lead b{ color:var(--ink); font-weight:600; }

  /* ---------- signature blocks ---------- */
  .sign-intro{ font-size:12px; line-height:1.5; color:var(--ink-soft); margin:0 0 5mm; }
  .sign-grid{ display:grid; grid-template-columns:1fr 1fr; gap:6mm; margin:0 0 5mm; }
  .sign-card{ border:1px solid var(--ink); padding:4.6mm 4.8mm 3.6mm; }
  .sign-card-h{ font-weight:700; font-size:9.5px; letter-spacing:.12em; text-transform:uppercase; color:var(--ink); margin:0 0 1.4mm; line-height:1.35; }
  .sign-card-sub{ font-size:10.5px; color:var(--ink-mute); line-height:1.4; margin:0 0 8mm; min-height:7mm; }
  .sign-line{ margin:0 0 4.4mm; }
  .sign-rule{ border-bottom:1px solid var(--ink); height:6.6mm; }
  .sign-cap{ font-size:8.5px; letter-spacing:.1em; text-transform:uppercase; color:var(--ink-mute); margin:1.2mm 0 0; }
  .sign-two{ display:grid; grid-template-columns:1fr 1fr; gap:5mm; }

  /* ---------- running footer (every page) ---------- */
  .run-foot{ margin-top:auto; padding-top:2.4mm; border-top:1px solid var(--ink); display:flex; align-items:center; justify-content:space-between; gap:6mm; }
  .foot-reg{ font-size:8.5px; line-height:1.4; color:var(--ink-mute); max-width:118mm; }
  .foot-reg b{ color:var(--ink-soft); font-weight:600; }
  .foot-right{ display:flex; align-items:center; gap:7mm; flex-shrink:0; }
  .foot-init{ font-size:8.5px; letter-spacing:.06em; text-transform:uppercase; color:var(--ink-mute); display:flex; align-items:center; gap:2.4mm; white-space:nowrap; }
  .init-box{ display:inline-block; width:12mm; height:6mm; border:1px solid var(--ink); vertical-align:middle; }
  .foot-page{ font-size:9px; letter-spacing:.06em; color:var(--ink-soft); white-space:nowrap; }
  .foot-page b{ color:var(--ink); font-weight:600; }

  /* ---------- print ---------- */
  @media print{
    @page{ size:A4 portrait; margin:0; }
    body{ background:#fff; }
    .screen-note,.toolbar{ display:none !important; }
    .stage{ display:block; padding:0; gap:0; }
    .sheet{ box-shadow:none; break-after:page; }
    .sheet:last-child{ break-after:auto; }
    .note,.internal{ background:#f1eee7 !important; }
    .ph{ background:#efeadf !important; }
    .ptable th{ background:#faf8f3 !important; }
  }


  /* merged / blank field helpers */
  .fill{ display:inline-block; min-width:32mm; border-bottom:1px solid var(--ink); height:1.05em; vertical-align:baseline; }

  /* proper bullet list (multi-column so long topic lists stay compact) */
  .blist{ list-style:none; margin:1.2mm 0 0.4mm; padding:0; column-width:44mm; column-gap:7mm; }
  .blist li{ position:relative; padding-left:4mm; font-size:10.9px; line-height:1.35; color:var(--ink-soft); break-inside:avoid; margin:0 0 0.8mm; }
  .blist li::before{ content:"\\2022"; position:absolute; left:0; color:var(--ink-mute); font-weight:700; }
`

const PAGE_01 = (F: AgreementFields, logo: string): string => `
<section class="sheet" data-screen-label="Page 1 — cover">
      <div class="sheet-inner">
        <header class="run-head">
          <img class="run-head-logo" src="${logo}" alt="The Anchor">
          <div class="run-head-meta">
            <span class="doc-kind">Zero-hours casual worker agreement</span>
            <span class="doc-ref">Ref <b>ANC/CWA/${F.year}/${F.initials}</b></span>
          </div>
        </header>

        <div class="body">
          <p class="cover-kicker">Worker contract &amp; written statement of particulars</p>
          <h1 class="cover-title">Zero-hours casual<br>worker agreement</h1>
          <p class="cover-script">Welcome to the team</p>

          <div class="meta">
            <div class="meta-cell">
              <p class="meta-label">Dated</p>
              <p class="meta-value">${F.agreementDate}</p>
            </div>
            <div class="meta-cell">
              <p class="meta-label">Reference</p>
              <p class="meta-value">ANC/CWA/${F.year}/${F.initials}</p>
            </div>
            <div class="meta-cell">
              <p class="meta-label">Type</p>
              <p class="meta-value">Zero-hours worker contract</p>
            </div>
          </div>

          <p class="lead">This agreement sets out the terms on which you may be offered, and may accept, shifts at The Anchor. It is a <b>worker contract, not a contract of employment</b>. It does not guarantee any work or any minimum number of hours. Together with its schedules it forms your written statement of particulars. Nothing in it removes any right you have by law. Please read it in full before you sign.</p>

          <p class="section-label">Parties</p>
          <div class="party">
            <span class="party-no">(1)</span>
            <p class="party-body"><span class="role">The Employer</span><b>Orange Jelly Limited</b>, trading as <b>The Anchor</b>, of The Anchor, Horton Road, Stanwell Moor Village, Surrey, TW19 6AQ (<b>&ldquo;we&rdquo;</b>, <b>&ldquo;us&rdquo;</b>, <b>&ldquo;our&rdquo;</b>).</p>
          </div>
          <div class="party">
            <span class="party-no">(2)</span>
            <p class="party-body"><span class="role">The Worker</span><b>${F.workerName}</b>, of ${F.workerAddress} (<b>&ldquo;you&rdquo;</b>, <b>&ldquo;your&rdquo;</b>).</p>
          </div>
        </div>

        <footer class="run-foot">
          <p class="foot-reg"><b>Orange Jelly Limited</b> trading as The Anchor &middot; The Anchor, Horton Road, Stanwell Moor Village, Surrey, TW19 6AQ &middot; Registered in England &amp; Wales no. 10537179 &middot; 01753 682707 &middot; manager@the-anchor.pub</p>
          <div class="foot-right">
            <span class="foot-init">Initials <span class="init-box"></span> <span class="init-box"></span></span>
            <span class="foot-page">Page <b class="pageno">1</b> of <b class="pagetot">11</b></span>
          </div>
        </footer>
      </div>
    </section>`

const PAGE_02 = (F: AgreementFields, logo: string): string => `
<section class="sheet" data-screen-label="Page 2 — definitions, status, particulars">
      <div class="sheet-inner">
        <header class="run-head">
          <img class="run-head-logo" src="${logo}" alt="The Anchor">
          <div class="run-head-meta">
            <span class="doc-kind">Zero-hours casual worker agreement</span>
            <span class="doc-ref">Ref <b>ANC/CWA/${F.year}/${F.initials}</b></span>
          </div>
        </header>

        <div class="body">
          <p class="section-label">Agreed terms</p>
          <ol class="contract">

            <li>
              <h2 class="clause-h">Definitions and interpretation</h2>
              <ol class="sub">
                <li><b>Framework agreement:</b> this document and its schedules, which set the terms that apply whenever you accept a shift, but which do not themselves oblige either party to offer or accept work.</li>
                <li><b>Shift / offer:</b> an invitation to work at a stated date, time and place, made through the planning portal or another written method we approve.</li>
                <li><b>Assignment:</b> a shift you have actively accepted. Each Assignment is a separate engagement governed by this framework agreement.</li>
                <li><b>Planning portal:</b> Orange Jelly's scheduling and time-recording system, or another written method approved by management from time to time.</li>
                <li>References to statutes include any legislation that replaces or amends them.</li>
              </ol>
            </li>

            <li>
              <h2 class="clause-h">Status and nature of the engagement</h2>
              <ol class="sub">
                <li>The parties intend you to have <b>worker status under section 230(3)(b) of the Employment Rights Act 1996</b>, and not employee status. Your actual legal status will ultimately depend on applicable law and how the arrangement operates in practice.</li>
                <li>We are <b>not obliged to offer you any work</b>, and you are <b>not obliged to accept</b> any work we offer. There are no guaranteed minimum hours and no guaranteed pattern or frequency of work.</li>
                <li>You do not have to remain available to us between shifts. Declining a shift is not misconduct and will not, by itself, result in any penalty.</li>
                <li>The number of shifts you have worked before does not guarantee any future shifts. There is no payment and no continuing obligation to work between accepted shifts, and each accepted shift is a separate Assignment.</li>
                <li>You may work for other businesses without our permission. You only need to tell us about outside work where it: (a) prevents you attending an already accepted shift; (b) creates a genuine conflict of interest; (c) risks misuse of our confidential information; or (d) creates a health-and-safety or working-time concern. You do not have to preserve general availability for us.</li>
                <li>Nothing in this agreement excludes or limits any statutory right. Where the law gives you a right, that right applies regardless of what this agreement says.</li>
              </ol>
            </li>

            <li>
              <h2 class="clause-h">Written statement of particulars</h2>
              <ol class="sub">
                <li>This agreement and its schedules together provide the day-one written particulars we must give you as a worker. Your individual details are set out in <b>Schedule 1 (Individual Particulars)</b>. Your job description will be provided to you separately.</li>
                <li>Your <b>start date</b> for the purposes of this arrangement is the date of your first Assignment, as recorded in Schedule 1. This engagement has no fixed end date, and no collective agreement affects your terms.</li>
                <li>These particulars are given to you when you start work. If any particular changes, we will tell you in writing.</li>
              </ol>
            </li>

          </ol>
        </div>

        <footer class="run-foot">
          <p class="foot-reg"><b>Orange Jelly Limited</b> trading as The Anchor &middot; Registered in England &amp; Wales no. 10537179 &middot; VAT 315 2036 47</p>
          <div class="foot-right">
            <span class="foot-init">Initials <span class="init-box"></span> <span class="init-box"></span></span>
            <span class="foot-page">Page <b class="pageno">2</b> of <b class="pagetot">11</b></span>
          </div>
        </footer>
      </div>
    </section>`

const PAGE_03 = (F: AgreementFields, logo: string): string => `
<section class="sheet" data-screen-label="Page 3 — shifts, changes, time recording">
      <div class="sheet-inner">
        <header class="run-head">
          <img class="run-head-logo" src="${logo}" alt="The Anchor">
          <div class="run-head-meta">
            <span class="doc-kind">Zero-hours casual worker agreement</span>
            <span class="doc-ref">Ref <b>ANC/CWA/${F.year}/${F.initials}</b></span>
          </div>
        </header>

        <div class="body">
          <ol class="contract" style="counter-reset:l1 3;">

            <li>
              <h2 class="clause-h">Offering and accepting shifts</h2>
              <ol class="sub">
                <li>Shifts will be offered through the planning portal or another written method approved by management. Each offer will identify the date and the start and expected finish time, together with the applicable hourly rate where it differs from your normal rate. Your role and duties are those set out in Schedule 1, and your normal place of work is The Anchor; the planning portal does not restate these for each shift.</li>
                <li>You have until <b>two weeks (14 days)</b> before a shift to accept or decline it through the planning portal or another agreed written method. If you have not declined an offered shift by that point, it is automatically treated as accepted and becomes a binding Assignment.</li>
                <li>Once a shift is accepted, or is automatically accepted under the two-week rule, it becomes an <b>Assignment</b>. You are then expected to attend and complete it, to follow the absence procedure in clause 11 if you cannot attend, and to understand that failure to attend without a reasonable explanation may be managed as a conduct or reliability matter.</li>
                <li>If, after a shift has become an Assignment, you find you are unable to work it (other than for genuine sickness or an emergency, which are dealt with under clause 11), it is your responsibility to arrange suitable cover from another member of the team and to confirm this with management. If cover cannot be arranged, you are expected to attend and work the Assignment.</li>
                <li>The planning portal will distinguish clearly between a shift being offered, accepted, declined, and cancelled or changed.</li>
                <li>Shifts are normally worked at The Anchor, Horton Road, Stanwell Moor Village, Surrey, TW19 6AQ. You may be offered work at an off-site event or another reasonable location, provided this is stated in the specific shift offer.</li>
              </ol>
            </li>

            <li>
              <h2 class="clause-h">Shift changes and cancellations</h2>
              <ol class="sub">
                <li>We will make reasonable efforts not to cancel or materially change an accepted shift.</li>
                <li>Where a change is necessary, we will: (a) discuss it directly with you wherever reasonably practicable, rather than simply changing it through the portal without communication; (b) give as much notice as reasonably practicable; and (c) consult you about material changes to the date, start or finish time, location or duties.</li>
                <li>Legitimate reasons may include reduced demand, closure, staffing changes, licensing restrictions, emergencies, safety concerns or other genuine operational requirements.</li>
                <li>You will be paid for: (a) all time you actually work; (b) any time we require you to remain at the workplace; and (c) required handover, closing, training or other duties.</li>
                <li>Any notice payment or cancellation payment required by law at the time will be provided. This agreement does not otherwise create a contractual cancellation payment.</li>
              </ol>
            </li>

            <li>
              <h2 class="clause-h">Time recording</h2>
              <ol class="sub">
                <li>You must clock in and out on our till and booking system at the start and end of every shift. No work should be carried out before you clock in or after you clock out.</li>
                <li>All required or authorised work will be paid. Unauthorised additional work may be addressed as a conduct issue, but payment will not be withheld for time you have genuinely worked.</li>
                <li>Deliberate falsification of time records may amount to gross misconduct.</li>
              </ol>
            </li>

          </ol>
        </div>

        <footer class="run-foot">
          <p class="foot-reg"><b>Orange Jelly Limited</b> trading as The Anchor &middot; Registered in England &amp; Wales no. 10537179 &middot; VAT 315 2036 47</p>
          <div class="foot-right">
            <span class="foot-init">Initials <span class="init-box"></span> <span class="init-box"></span></span>
            <span class="foot-page">Page <b class="pageno">3</b> of <b class="pagetot">11</b></span>
          </div>
        </footer>
      </div>
    </section>`

const PAGE_04 = (F: AgreementFields, logo: string): string => `
<section class="sheet" data-screen-label="Page 4 — pay and holiday">
      <div class="sheet-inner">
        <header class="run-head">
          <img class="run-head-logo" src="${logo}" alt="The Anchor">
          <div class="run-head-meta">
            <span class="doc-kind">Zero-hours casual worker agreement</span>
            <span class="doc-ref">Ref <b>ANC/CWA/${F.year}/${F.initials}</b></span>
          </div>
        </header>

        <div class="body">
          <ol class="contract" style="counter-reset:l1 6;">

            <li>
              <h2 class="clause-h">Pay, pay period and payroll</h2>
              <ol class="sub">
                <li>Your <b>base hourly rate</b> is the actual rate stated in Schedule 1, which applies when this agreement is issued. Your rate is not automatically the National Living Wage; younger workers may be entitled to a different National Minimum Wage rate.</li>
                <li>Your pay will be no less than the statutory minimum that applies to you based on your age and apprentice status, and will automatically increase where required to comply with statutory minimum-wage changes. We may also choose to increase your rate separately and will confirm any change in writing.</li>
                <li><b>Rolled-up holiday pay</b> is paid in addition to your base rate and is not included within it (see clause 8).</li>
                <li>PAYE income tax, National Insurance, pension contributions and other lawful deductions will be made. There is no enhanced rate for weekends, evenings, bank holidays or overtime unless we confirm one in writing.</li>
                <li><b>Pay period:</b> the 25th of one month to the 24th of the following month. <b>Pay date:</b> the last weekday of the month. You must submit accurate records promptly so payroll can be processed.</li>
                <li><b>Overpayments:</b> if we accidentally overpay you, we may recover the overpayment from future pay or by another reasonable method, subject to clause 20 and the law.</li>
                <li><b>Other employment:</b> you must tell us promptly if you take up any other employment or engagement, so that PAYE and payroll can be operated correctly. Unless you tell us otherwise, we will treat this as your only job for tax and payroll purposes.</li>
                <li><b>Your tax affairs:</b> you are responsible for your own overall tax position. Where tax has not been correctly accounted for on work you have done, beyond what we are legally required to deduct and report, it is your responsibility to work with HM Revenue &amp; Customs or any other relevant body to put it right.</li>
              </ol>
            </li>

            <li>
              <h2 class="clause-h">Holiday entitlement and rolled-up holiday pay</h2>
              <ol class="sub">
                <li><b>Holiday year:</b> 1 January to 31 December. You are intended to be an <b>irregular-hours worker</b> for statutory holiday purposes, and your entitlement accrues according to the statutory rules for irregular-hours workers.</li>
                <li>Rolled-up holiday pay will normally be calculated at <b>12.07%</b> of your qualifying pay, or by another method required by law. It is paid in addition to your base wages and shown as a separate line on your payslip. Rolled-up holiday pay may currently be used only for qualifying irregular-hours and part-year workers.</li>
                <li>Special statutory calculations apply during sickness and statutory leave, your statutory carry-over rights remain protected, and we will keep holiday and holiday-pay records as required by law. Any outstanding statutory holiday payment will be dealt with correctly when this agreement ends.</li>
                <li><b>Holiday is not the same as availability:</b>
                  <ol class="sub2">
                    <li>You do not need permission merely to decline an unaccepted shift or to mark yourself unavailable for future offers.</li>
                    <li>Holiday leave should still be recorded, so that statutory leave is taken and recorded properly.</li>
                    <li>An already accepted shift cannot be treated as cancelled just by submitting a holiday request.</li>
                  </ol>
                </li>
                <li><b>Bank and public holidays</b> are normal trading days. There is no separate or enhanced bank-holiday payment unless agreed in writing.</li>
              </ol>
            </li>

          </ol>
        </div>

        <footer class="run-foot">
          <p class="foot-reg"><b>Orange Jelly Limited</b> trading as The Anchor &middot; Registered in England &amp; Wales no. 10537179 &middot; VAT 315 2036 47</p>
          <div class="foot-right">
            <span class="foot-init">Initials <span class="init-box"></span> <span class="init-box"></span></span>
            <span class="foot-page">Page <b class="pageno">4</b> of <b class="pagetot">11</b></span>
          </div>
        </footer>
      </div>
    </section>`

const PAGE_05 = (F: AgreementFields, logo: string): string => `
<section class="sheet" data-screen-label="Page 5 — breaks, young workers, sickness, review">
      <div class="sheet-inner">
        <header class="run-head">
          <img class="run-head-logo" src="${logo}" alt="The Anchor">
          <div class="run-head-meta">
            <span class="doc-kind">Zero-hours casual worker agreement</span>
            <span class="doc-ref">Ref <b>ANC/CWA/${F.year}/${F.initials}</b></span>
          </div>
        </header>

        <div class="body">
          <ol class="contract" style="counter-reset:l1 8;">

            <li>
              <h2 class="clause-h">Breaks and working time</h2>
              <ol class="sub">
                <li><b>Adult workers (18 and over):</b> where a shift lasts more than six hours you are entitled to an uninterrupted rest break of at least 20 minutes. <b>Statutory rest breaks are unpaid.</b></li>
                <li><b>Workers aged 16 or 17:</b> the age-specific rules in <b>Schedule 2 (Young Worker Schedule)</b> apply, including a 30-minute break when working more than four and a half hours.</li>
                <li>Breaks must actually be taken. You must not continue working during an unpaid break, and you must report any interrupted break so compensatory rest can be provided where the law requires it.</li>
              </ol>
            </li>

            <li>
              <h2 class="clause-h">Young workers and alcohol</h2>
              <ol class="sub">
                <li>Where you are aged 16 or 17, <b>Schedule 2 (Young Worker Schedule)</b> applies automatically and addresses age-specific hours and rest, restricted duties, risk assessments, supervision and late-night work.</li>
                <li>Before engaging a 16-year-old we must confirm they are above compulsory school-leaving age. Anyone below school-leaving age may require a separate child-employment process and local authority approval.</li>
                <li>A worker aged 16 or 17 may serve alcohol only in the circumstances permitted by licensing law and with the required approval or supervision of an appropriate adult. Any staff-drink arrangement involving alcohol is not available to any worker under 18 (see clause 16).</li>
              </ol>
            </li>

            <li>
              <h2 class="clause-h">Sickness and absence</h2>
              <ol class="sub">
                <li>This absence procedure applies only to an <b>Assignment you have already accepted</b>. If you cannot attend, you must: (a) report your absence by telephone as soon as reasonably practicable and, where reasonably practicable, at least four hours before the shift, to <b>Billy Summers on 07956 315214</b>, <b>Peter Pitcher on 07990 587315</b>, or the <b>duty manager on 01753 682707</b>; (b) where telephoning is genuinely impracticable, use another reasonable method or have someone contact us on your behalf; (c) keep us updated on your expected return date and complete any required return-to-work or absence form; and (d) provide a fit note after more than seven calendar days of sickness.</li>
                <li>There is no contractual company sick-pay scheme. Statutory Sick Pay will be paid where the statutory eligibility requirements are met.</li>
                <li>Protected absences will not automatically result in fewer shifts. Attendance concerns will be considered fairly and individually, and we will consider our equality obligations and any reasonable adjustments. Pregnancy, disability, family leave, whistleblowing, health-and-safety action and other protected reasons must not be treated as ordinary unreliability.</li>
              </ol>
            </li>

            <li>
              <h2 class="clause-h">Initial review period</h2>
              <ol class="sub">
                <li>There is an initial review period of <b>three months</b> from your first Assignment, which may be extended to a maximum of six months. It assesses performance, conduct, training, reliability and suitability.</li>
                <li>Completing the review period does not guarantee future work, does not create regular hours, and does not convert the arrangement into employment.</li>
                <li>Where you are unsuitable, we may stop offering future Assignments, subject to applicable law and a fair process where appropriate. You may ask not to receive further offers at any time.</li>
              </ol>
            </li>

          </ol>
        </div>

        <footer class="run-foot">
          <p class="foot-reg"><b>Orange Jelly Limited</b> trading as The Anchor &middot; Registered in England &amp; Wales no. 10537179 &middot; VAT 315 2036 47</p>
          <div class="foot-right">
            <span class="foot-init">Initials <span class="init-box"></span> <span class="init-box"></span></span>
            <span class="foot-page">Page <b class="pageno">5</b> of <b class="pagetot">11</b></span>
          </div>
        </footer>
      </div>
    </section>`

const PAGE_06 = (F: AgreementFields, logo: string): string => `
<section class="sheet" data-screen-label="Page 6 — termination, training, benefits, tips">
      <div class="sheet-inner">
        <header class="run-head">
          <img class="run-head-logo" src="${logo}" alt="The Anchor">
          <div class="run-head-meta">
            <span class="doc-kind">Zero-hours casual worker agreement</span>
            <span class="doc-ref">Ref <b>ANC/CWA/${F.year}/${F.initials}</b></span>
          </div>
        </header>

        <div class="body">
          <ol class="contract" style="counter-reset:l1 12;">

            <li>
              <h2 class="clause-h">Ending the agreement</h2>
              <ol class="sub">
                <li>Either party may end this framework agreement by giving written notice to the other. Ending it does not, by itself, cancel an Assignment already accepted; where reasonably practicable the parties will agree how any accepted Assignment is completed or released.</li>
                <li>We may end this agreement immediately for gross misconduct, serious breach, dishonesty, theft, violence, serious licensing or safety breaches, loss of the right to work, falsification of records or another material breach.</li>
                <li>Any statutory notice, procedure and payment requirements will apply where the law requires them. This agreement does not rely solely on us silently ceasing to offer shifts. Final wages, accrued holiday pay and any lawful deductions will be handled correctly on termination.</li>
                <li>Ending this agreement does not affect the confidentiality, deductions, repayment, property-return or other clauses intended to survive it (see clause 22).</li>
              </ol>
            </li>

            <li>
              <h2 class="clause-h">Training</h2>
              <ol class="sub">
                <li>You must complete mandatory training that we authorise or require for your role. Required training time is working time and will be paid. We will meet the cost of mandatory external courses where we require you to obtain them; optional training is paid only where agreed in advance.</li>
                <li>You will not be penalised where we failed to give you a reasonable opportunity to complete required training. We may pause offering shifts where legally or operationally required training has not been completed. Requirements may vary by role and may include:
                  <ul class="blist">
                    <li>Health &amp; safety</li>
                    <li>Licensing</li>
                    <li>Age verification</li>
                    <li>COSHH</li>
                    <li>Customer service</li>
                    <li>Food safety</li>
                    <li>Allergens</li>
                    <li>Fire safety</li>
                    <li>Data protection</li>
                    <li>Cash handling</li>
                    <li>Conflict management</li>
                  </ul>
                </li>
              </ol>
            </li>

            <li>
              <h2 class="clause-h">Benefits, clothing and pension</h2>
              <ol class="sub">
                <li>There are no contractual benefits other than those expressly stated in this agreement. In particular, no contractual meals or staff discount are provided.</li>
                <li>Branded T-shirts may be offered at our discretion. Providing branded clothing does not create a continuing contractual benefit, and any company property remains company property.</li>
                <li>Workplace pension duties will be applied according to your age and earnings. Workers who do not qualify for automatic enrolment keep any statutory right to opt in or join a scheme. Pension thresholds are set by law and are not fixed by this agreement.</li>
              </ol>
            </li>

            <li>
              <h2 class="clause-h">Tips and customer-purchased staff drinks</h2>
              <ol class="sub">
                <li>We do not add a service charge and do not accept tips through our card terminals. We ask that you do not accept tips. If a customer does give you a cash tip, it belongs entirely to you; we do not pool, hold, allocate or deduct from it, and you are solely responsible for declaring it and for any personal tax due on it.</li>
                <li><b>Customer-purchased staff drinks:</b> a customer may voluntarily buy a drink for a worker as a gesture of appreciation. You are not required to accept it; it is not wages or contractual remuneration and has no cash alternative. It may only be consumed when you are off duty. Alcoholic drinks are subject to licensing law, responsible-service requirements and management policy, are not available to anyone under 18, and we may refuse or restrict the arrangement where necessary for safety, licensing, conduct or welfare reasons.</li>
              </ol>
            </li>

          </ol>
        </div>

        <footer class="run-foot">
          <p class="foot-reg"><b>Orange Jelly Limited</b> trading as The Anchor &middot; Registered in England &amp; Wales no. 10537179 &middot; VAT 315 2036 47</p>
          <div class="foot-right">
            <span class="foot-init">Initials <span class="init-box"></span> <span class="init-box"></span></span>
            <span class="foot-page">Page <b class="pageno">6</b> of <b class="pagetot">11</b></span>
          </div>
        </footer>
      </div>
    </section>`

const PAGE_07 = (F: AgreementFields, logo: string): string => `
<section class="sheet" data-screen-label="Page 7 — conduct, confidentiality, right to work">
      <div class="sheet-inner">
        <header class="run-head">
          <img class="run-head-logo" src="${logo}" alt="The Anchor">
          <div class="run-head-meta">
            <span class="doc-kind">Zero-hours casual worker agreement</span>
            <span class="doc-ref">Ref <b>ANC/CWA/${F.year}/${F.initials}</b></span>
          </div>
        </header>

        <div class="body">
          <ol class="contract" style="counter-reset:l1 16;">

            <li>
              <h2 class="clause-h">Conduct and company policies</h2>
              <ol class="sub">
                <li>Detailed operational rules are kept in a separate, non-contractual staff handbook. These policies are non-contractual and may be reasonably introduced, replaced or amended. You must comply with our policies, which cover:
                  <ul class="blist">
                    <li>Licensing &amp; age verification</li>
                    <li>Alcohol &amp; drugs</li>
                    <li>Health &amp; safety</li>
                    <li>Fire safety</li>
                    <li>Food hygiene &amp; allergens</li>
                    <li>Equality, dignity &amp; harassment</li>
                    <li>Whistleblowing</li>
                    <li>Data protection</li>
                    <li>CCTV &amp; monitoring</li>
                    <li>Social media</li>
                    <li>Attendance &amp; timekeeping</li>
                    <li>Till &amp; cash handling</li>
                    <li>Theft &amp; fraud</li>
                    <li>Dress &amp; hygiene</li>
                    <li>Staff mobile phones</li>
                    <li>Violence &amp; customer safety</li>
                    <li>Accidents &amp; incident reporting</li>
                  </ul>
                </li>
                <li>To protect our legitimate business interests and customer relationships, while you are engaged by us you may not also work for, or provide services to, any other public house, bar or similar licensed hospitality venue within a <b>three-mile radius</b> of The Anchor without our prior written consent. Other work outside that radius, or in an unrelated field, is not restricted, provided it does not conflict with your obligations to us or your availability for accepted Assignments.</li>
              </ol>
            </li>

            <li>
              <h2 class="clause-h">Confidentiality and protected disclosures</h2>
              <ol class="sub">
                <li>You must keep confidential any non-public information about the business, staff, customers, suppliers, pricing, operations and security, during and after your engagement.</li>
                <li>Confidentiality does <b>not</b> prevent you from: making a protected whistleblowing disclosure; reporting suspected criminal conduct; contacting a regulator or law-enforcement body; exercising a statutory right; obtaining confidential legal, medical or professional advice; speaking to a trade union or workplace representative; making a disclosure required by law; or discussing pay where legally protected.</li>
                <li>Any restriction on soliciting staff or customers is limited to what is reasonable and proportionate to protect confidential information, and does not prevent ordinary future employment.</li>
              </ol>
            </li>

            <li>
              <h2 class="clause-h">Right to work</h2>
              <ol class="sub">
                <li>This arrangement is conditional on you having the continuing legal right to work in the United Kingdom.</li>
                <li>You must provide the required documents or digital status information, tell us immediately of any restriction or change, and co-operate with lawful repeat checks.</li>
                <li>We may suspend offers or end this agreement where you no longer have the legal right to perform the work.</li>
              </ol>
            </li>

          </ol>
        </div>

        <footer class="run-foot">
          <p class="foot-reg"><b>Orange Jelly Limited</b> trading as The Anchor &middot; Registered in England &amp; Wales no. 10537179 &middot; VAT 315 2036 47</p>
          <div class="foot-right">
            <span class="foot-init">Initials <span class="init-box"></span> <span class="init-box"></span></span>
            <span class="foot-page">Page <b class="pageno">7</b> of <b class="pagetot">11</b></span>
          </div>
        </footer>
      </div>
    </section>`

const PAGE_08 = (F: AgreementFields, logo: string): string => `
<section class="sheet" data-screen-label="Page 8 — deductions, grievances, general">
      <div class="sheet-inner">
        <header class="run-head">
          <img class="run-head-logo" src="${logo}" alt="The Anchor">
          <div class="run-head-meta">
            <span class="doc-kind">Zero-hours casual worker agreement</span>
            <span class="doc-ref">Ref <b>ANC/CWA/${F.year}/${F.initials}</b></span>
          </div>
        </header>

        <div class="body">
          <ol class="contract" style="counter-reset:l1 19;">

            <li>
              <h2 class="clause-h">Company property and deductions</h2>
              <ol class="sub">
                <li>Any property we provide (for example uniform, keys, access cards, equipment) remains ours, must be looked after, and must be returned on request and when your engagement ends.</li>
                <li><b>Before deducting</b> for loss, damage, stock or till shortages, we will: (a) make reasonable enquiries; (b) tell you what is alleged; and (c) give you an opportunity to respond. The loss must be reasonably attributable to your act, omission, negligence or breach, only our actual reasonable loss is recoverable, fair wear and tear is excluded, and shared till shortages will not automatically be attributed to one person.</li>
                <li>We will follow all statutory deduction and minimum-wage limits. Where a deduction cannot lawfully be made from wages, we may require repayment by another reasonable method.</li>
                <li>We retain express authority to lawfully recover: accidental overpayments; unreturned company property; deliberate or negligent damage; identified cash or stock losses; and other specific sums agreed in writing.</li>
                <li>Where we are required by law, or by a court or other competent authority, to make a deduction from your pay (for example an attachment of earnings order, a statutory deduction, or a direction from HM Revenue &amp; Customs), we will make that deduction, and we will always do so in accordance with the law.</li>
              </ol>
            </li>

            <li>
              <h2 class="clause-h">Grievances, disciplinary matters and appeals</h2>
              <ol class="sub">
                <li>Our disciplinary and grievance procedures are non-contractual. We intend to follow a fair process and relevant Acas guidance where applicable.</li>
                <li><b>First point of contact:</b> Billy, <a href="mailto:billy@orangejelly.co.uk">billy@orangejelly.co.uk</a>. <b>Escalation or appeal:</b> Peter Pitcher, <a href="mailto:peter@orangejelly.co.uk">peter@orangejelly.co.uk</a>.</li>
                <li>Where the issue concerns Billy, it may be raised directly with Peter. Disciplinary appeals should be submitted to Peter unless he made the original decision, in which case we will nominate another appropriate person or independent adviser.</li>
              </ol>
            </li>

            <li>
              <h2 class="clause-h">General</h2>
              <ol class="sub">
                <li><b>Entire agreement:</b> this agreement and its schedules are the entire agreement between the parties on this engagement and replace any earlier understanding. Any variation must be in writing. Company policies are non-contractual.</li>
                <li>Nothing in this agreement excludes or limits any statutory right; where there is a conflict, your statutory rights prevail. If any clause is unlawful or unenforceable, the remaining clauses continue to apply. A person who is not a party has no right to enforce this agreement.</li>
                <li>Notices must be in writing. Electronic signatures and records are accepted and valid. The confidentiality, deductions and repayment, and return-of-property provisions survive termination.</li>
                <li>This agreement is governed by the law of <b>England and Wales</b>, whose courts have exclusive jurisdiction. You confirm you have received, or can access, the staff handbook and privacy notice.</li>
              </ol>
            </li>

          </ol>
        </div>

        <footer class="run-foot">
          <p class="foot-reg"><b>Orange Jelly Limited</b> trading as The Anchor &middot; Registered in England &amp; Wales no. 10537179 &middot; VAT 315 2036 47</p>
          <div class="foot-right">
            <span class="foot-init">Initials <span class="init-box"></span> <span class="init-box"></span></span>
            <span class="foot-page">Page <b class="pageno">8</b> of <b class="pagetot">11</b></span>
          </div>
        </footer>
      </div>
    </section>`

const PAGE_09 = (F: AgreementFields, logo: string): string => `
<section class="sheet" data-screen-label="Page 9 — signatures">
      <div class="sheet-inner">
        <header class="run-head">
          <img class="run-head-logo" src="${logo}" alt="The Anchor">
          <div class="run-head-meta">
            <span class="doc-kind">Zero-hours casual worker agreement</span>
            <span class="doc-ref">Ref <b>ANC/CWA/${F.year}/${F.initials}</b></span>
          </div>
        </header>

        <div class="body">
          <p class="section-label">Signatures</p>
          <p class="sign-intro">By signing below, both parties confirm they have read and agree to the terms of this zero-hours casual worker agreement and its schedules, dated ${F.agreementDate}. This is a worker contract and not a contract of employment. It does not guarantee any work or minimum hours, and it does not remove any right you have by law.</p>

          <div class="sign-grid">
            <div class="sign-card">
              <p class="sign-card-h">Signed for and on behalf of Orange Jelly Limited (t/a The Anchor)</p>
              <p class="sign-card-sub">Manager issuing this agreement: ${F.managerName} (${F.managerEmail})</p>
              <div class="sign-line"><div class="sign-rule"></div><p class="sign-cap">Signature</p></div>
              <div class="sign-two">
                <div class="sign-line"><div class="sign-rule"></div><p class="sign-cap">Name</p></div>
                <div class="sign-line"><div class="sign-rule"></div><p class="sign-cap">Position</p></div>
              </div>
              <div class="sign-line" style="margin-bottom:0;"><div class="sign-rule"></div><p class="sign-cap">Date</p></div>
            </div>

            <div class="sign-card">
              <p class="sign-card-h">Signed by the Worker</p>
              <p class="sign-card-sub">${F.workerName}</p>
              <div class="sign-line"><div class="sign-rule"></div><p class="sign-cap">Signature</p></div>
              <div class="sign-two">
                <div class="sign-line"><div class="sign-rule"></div><p class="sign-cap">Name</p></div>
                <div class="sign-line" style="visibility:hidden;"><div class="sign-rule"></div><p class="sign-cap">&nbsp;</p></div>
              </div>
              <div class="sign-line" style="margin-bottom:0;"><div class="sign-rule"></div><p class="sign-cap">Date</p></div>
            </div>
          </div>

          <div class="note">
            Where the Worker is aged 16 or 17, a parent or guardian should also acknowledge this agreement, and Schedule 2 (Young Worker Schedule) applies. Keep a signed copy for your records.
          </div>
        </div>

        <footer class="run-foot">
          <p class="foot-reg"><b>Orange Jelly Limited</b> trading as The Anchor &middot; The Anchor, Horton Road, Stanwell Moor Village, Surrey, TW19 6AQ &middot; Registered in England &amp; Wales no. 10537179 &middot; 01753 682707 &middot; manager@the-anchor.pub</p>
          <div class="foot-right">
            <span class="foot-init">Initials <span class="init-box"></span> <span class="init-box"></span></span>
            <span class="foot-page">Page <b class="pageno">9</b> of <b class="pagetot">11</b></span>
          </div>
        </footer>
      </div>
    </section>`

const PAGE_10 = (F: AgreementFields, logo: string): string => `
<section class="sheet" data-screen-label="Page 10 — Schedule 1 particulars">
      <div class="sheet-inner">
        <header class="run-head">
          <img class="run-head-logo" src="${logo}" alt="The Anchor">
          <div class="run-head-meta">
            <span class="doc-kind">Schedule 1 — Individual particulars</span>
            <span class="doc-ref">Ref <b>ANC/CWA/${F.year}/${F.initials}</b></span>
          </div>
        </header>

        <div class="body">
          <p class="sched-kicker">Schedule 1</p>
          <h2 class="sched-title">Individual particulars</h2>
          <p class="sched-lead">Complete one schedule per worker. These particulars form part of the written statement of particulars.</p>

          <table class="ptable">
            <tbody>
              <tr><th>Agreement date</th><td>${F.agreementDate}</td></tr>
              <tr><th>Worker's full legal name</th><td>${F.workerName}</td></tr>
              <tr><th>Worker's address</th><td>${F.workerAddress}</td></tr>
              <tr><th>Date of birth / age category</th><td>${F.dobLine}</td></tr>
              <tr><th>Job title</th><td>${F.jobTitle}</td></tr>
              <tr><th>Job description</th><td>Provided separately</td></tr>
              <tr><th>Start date (first Assignment)</th><td>${F.startDate}</td></tr>
              <tr><th>Normal workplace</th><td>The Anchor, Horton Road, Stanwell Moor Village, Surrey, TW19 6AQ (off-site work only where stated in the shift offer)</td></tr>
              <tr><th>Base hourly rate</th><td>${F.hourlyRate} per hour</td></tr>
              <tr><th>NMW age band / apprentice category</th><td>${F.nmwBand}</td></tr>
              <tr><th>Young Worker Schedule applies?</th><td>${F.youngWorker}</td></tr>
              <tr><th>Manager issuing the agreement</th><td>${F.managerName}</td></tr>
            </tbody>
          </table>

          <div class="note">
            Confirm the base rate is at least the applicable statutory minimum for the worker's NMW age band or apprentice status before issuing. The rate increases automatically to meet statutory minimum-wage changes (clause 7).
          </div>
        </div>

        <footer class="run-foot">
          <p class="foot-reg"><b>Orange Jelly Limited</b> trading as The Anchor &middot; Registered in England &amp; Wales no. 10537179 &middot; VAT 315 2036 47</p>
          <div class="foot-right">
            <span class="foot-init">Initials <span class="init-box"></span> <span class="init-box"></span></span>
            <span class="foot-page">Page <b class="pageno">10</b> of <b class="pagetot">11</b></span>
          </div>
        </footer>
      </div>
    </section>`

const PAGE_11 = (F: AgreementFields, logo: string): string => `
<section class="sheet" data-screen-label="Page 11 — Schedule 2 young worker">
      <div class="sheet-inner">
        <header class="run-head">
          <img class="run-head-logo" src="${logo}" alt="The Anchor">
          <div class="run-head-meta">
            <span class="doc-kind">Schedule 2 — Young Worker Schedule</span>
            <span class="doc-ref">Ref <b>ANC/CWA/${F.year}/${F.initials}</b></span>
          </div>
        </header>

        <div class="body">
          <p class="sched-kicker">Schedule 2 — applies only where the worker is 16 or 17</p>
          <h2 class="sched-title">Young Worker Schedule</h2>
          <p class="sched-lead">This schedule applies automatically to any worker aged 16 or 17 and overrides the adult break and working-time rules where it is more protective.</p>

          <div class="internal">
            <p class="internal-h">Internal use — when to include this schedule</p>
            <p class="internal-p">Issue this schedule <b>only to a worker who is under 18</b> (aged 16 or 17). Do not include or print it for a worker aged 18 or over.</p>
          </div>

          <ol class="contract" style="margin-top:4mm;">
            <li>
              <h2 class="clause-h">Rest, hours and night work</h2>
              <ol class="sub">
                <li>A 30-minute rest break must be taken when working more than four and a half hours.</li>
                <li>You are generally entitled to 12 hours' daily rest and 48 hours' weekly rest.</li>
                <li>Restrictions apply to night work and to shift length. We will apply the applicable limits, taking account of any permitted hospitality or catering exceptions.</li>
              </ol>
            </li>
            <li>
              <h2 class="clause-h">Duties, supervision and safety</h2>
              <ol class="sub">
                <li>Certain duties are prohibited or restricted for under-18s. We will carry out and act on appropriate risk assessments, provide suitable supervision, and ensure safe use of equipment.</li>
                <li>Before engaging a 16-year-old, we will confirm they are above compulsory school-leaving age. Anyone below school-leaving age may require a separate child-employment process and local authority approval.</li>
              </ol>
            </li>
            <li>
              <h2 class="clause-h">Alcohol</h2>
              <ol class="sub">
                <li>You may serve alcohol only in circumstances permitted by licensing law and with the approval or supervision of an appropriate adult.</li>
                <li>Any staff-drink arrangement involving alcohol is not available to anyone under 18.</li>
              </ol>
            </li>
          </ol>

          <p class="section-label" style="margin-top:6mm;">Parent or guardian acknowledgement (16 or 17 only)</p>
          <p class="sign-intro">I confirm I have read this schedule and the agreement.</p>
          <div class="sign-two">
            <div class="sign-line" style="margin-bottom:0;"><div class="sign-rule"></div><p class="sign-cap">Parent / guardian name</p></div>
            <div class="sign-two">
              <div class="sign-line" style="margin-bottom:0;"><div class="sign-rule"></div><p class="sign-cap">Signature</p></div>
              <div class="sign-line" style="margin-bottom:0;"><div class="sign-rule"></div><p class="sign-cap">Date</p></div>
            </div>
          </div>
        </div>

        <footer class="run-foot">
          <p class="foot-reg"><b>Orange Jelly Limited</b> trading as The Anchor &middot; Registered in England &amp; Wales no. 10537179 &middot; VAT 315 2036 47</p>
          <div class="foot-right">
            <span class="foot-init">Initials <span class="init-box"></span> <span class="init-box"></span></span>
            <span class="foot-page">Page <b class="pageno">11</b> of <b class="pagetot">11</b></span>
          </div>
        </footer>
      </div>
    </section>`


/**
 * Render the full zero-hours casual worker agreement as print-ready A4 HTML.
 * Pages 1-10 are always included; page 11 (Young Worker Schedule) is appended
 * only for workers under 18. Page numbers and the total adjust automatically.
 */
export function generateWorkerAgreementHTML(data: WorkerAgreementData): string {
  const logo = data.logoUrl
  const F: AgreementFields = {
    year: esc(data.year),
    initials: field(data.initials),
    agreementDate: field(data.agreementDate),
    workerName: field(data.workerName),
    workerAddress: field(data.workerAddress),
    dobLine: field(data.dobLine),
    jobTitle: field(data.jobTitle),
    startDate: field(data.startDate),
    hourlyRate: field(data.hourlyRate),
    nmwBand: field(data.nmwBand),
    youngWorker: esc(data.youngWorker),
    managerName: field(data.managerName),
    managerEmail: esc(data.managerEmail),
  }

  const pages: string[] = [
    PAGE_01(F, logo),
    PAGE_02(F, logo),
    PAGE_03(F, logo),
    PAGE_04(F, logo),
    PAGE_05(F, logo),
    PAGE_06(F, logo),
    PAGE_07(F, logo),
    PAGE_08(F, logo),
    PAGE_09(F, logo),
    PAGE_10(F, logo),
  ]
  if (data.includeYoungWorkerSchedule) {
    pages.push(PAGE_11(F, logo))
  }

  const total = pages.length
  const sheets = pages.map((sheet, i) => numberSheet(sheet, i + 1, total)).join('\n')

  return `<!doctype html>
<html lang="en-GB">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Zero-hours casual worker agreement</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=DM+Serif+Display:ital@0;1&family=Outfit:wght@300;400;500;600;700;800&family=Clicker+Script&display=swap" rel="stylesheet">
<style>${STYLE}</style>
</head>
<body>
<div class="stage">
${sheets}
</div>
</body>
</html>`
}
