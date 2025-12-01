export interface WeeklyReportRow {
  date: string;
  status: string;
  notes: string | null;
  
  cash_expected: number;
  cash_actual: number;
  
  card_expected: number;
  card_actual: number;
  
  stripe_actual: number;
  
  total_expected: number;
  total_actual: number;
  total_variance: number;
  
  daily_target: number;
  accumulated_target: number;
  accumulated_revenue: number;
  
  cash_counts: { denomination: number; total: number }[];
}

interface TemplateProps {
  weekData: WeeklyReportRow[];
  siteName: string;
  weekStartDate: string;
  logoUrl?: string;
}

function getWeekNumber(d: string) {
  const date = new Date(d);
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() + 3 - (date.getDay() + 6) % 7);
  const week1 = new Date(date.getFullYear(), 0, 4);
  return 1 + Math.round(((date.getTime() - week1.getTime()) / 86400000 - 3 + (week1.getDay() + 6) % 7) / 7);
}

function formatDate(d: string) {
  return new Date(d).toLocaleDateString('en-GB', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
}

function formatCurrency(val: number) {
  return val !== 0 ? '£' + val.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '';
}

export function generateWeeklyCashupHTML({ weekData, siteName, weekStartDate, logoUrl }: TemplateProps): string {
  const logoHtml = logoUrl 
    ? `<img src="${logoUrl}" alt="Logo" class="h-16" />` 
    : `<h1 class="text-2xl font-bold text-right">THE ANCHOR<br><span class="text-sm font-normal text-gray-600">Stanwell Moor Village</span></h1>`;

  const weekNum = getWeekNumber(weekStartDate);
  const formattedDate = formatDate(weekStartDate);

  const rows = weekData.map(row => {
    const dateObj = new Date(row.date);
    const dayNum = dateObj.toLocaleDateString('en-GB', { month: 'long', day: 'numeric' });
    const weekDay = dateObj.toLocaleDateString('en-GB', { weekday: 'long' });
    
    const cashVariance = row.cash_actual - row.cash_expected;
    const percentDelivery = row.accumulated_target > 0 
      ? Math.round((row.accumulated_revenue / row.accumulated_target) * 100) 
      : 0;

    return `
      <tr class="text-xs h-8">
        <td class="border border-black p-1 text-center">${dayNum}</td>
        <td class="border border-black p-1 text-center">${weekDay}</td>
        
        <!-- CASH -->
        <td class="border border-black p-1 text-right">${formatCurrency(row.cash_expected)}</td>
        <td class="border border-black p-1 text-right">${formatCurrency(row.cash_actual)}</td>
        <td class="border border-black p-1 text-right">${formatCurrency(cashVariance)}</td>
        
        <!-- CARD -->
        <td class="border border-black p-1 text-right">${formatCurrency(row.card_expected)}</td> <!-- Image: Till Z Report Total -->
        
        <!-- STRIPE -->
        <td class="border border-black p-1 text-right">${formatCurrency(row.stripe_actual)}</td>
        
        <!-- TOTALS -->
        <td class="border border-black p-1 text-right">${formatCurrency(row.total_expected)}</td>
        <td class="border border-black p-1 text-right">${formatCurrency(row.total_actual)}</td>
        <td class="border border-black p-1 text-right">${formatCurrency(row.total_variance)}</td>
        
        <!-- TARGETS -->
        <td class="border border-black p-1 text-right">${formatCurrency(row.accumulated_target)}</td> <!-- Daily Accumulated Target -->
        <td class="border border-black p-1 text-right">${formatCurrency(row.accumulated_revenue)}</td> <!-- Weekly Accumulative Total -->
        <td class="border border-black p-1 text-center">${percentDelivery}%</td>
        
        <!-- NOTES -->
        <td class="border border-black p-1 text-left" style="font-size: 7px;">${row.notes || ''}</td>
      </tr>
    `;
  }).join('');

  // Totals Calculation
  const totals = weekData.reduce((acc, r) => ({
    cash_expected: acc.cash_expected + r.cash_expected,
    cash_actual: acc.cash_actual + r.cash_actual,
    cash_variance: acc.cash_variance + (r.cash_actual - r.cash_expected),
    card_expected: acc.card_expected + r.card_expected,
    stripe_actual: acc.stripe_actual + r.stripe_actual,
    total_expected: acc.total_expected + r.total_expected,
    total_actual: acc.total_actual + r.total_actual,
    total_variance: acc.total_variance + r.total_variance
  }), { 
    cash_expected: 0, cash_actual: 0, cash_variance: 0,
    card_expected: 0, stripe_actual: 0,
    total_expected: 0, total_actual: 0, total_variance: 0
  });

  // Denominations Breakdown
  const DENOMINATIONS = [50, 20, 10, 5, 2, 1, 0.5, 0.2, 0.1, 0.05, 0.02, 0.01];
  
  const denomRows = weekData.map(row => {
    const cells = DENOMINATIONS.map(denom => {
      const match = row.cash_counts?.find(c => Number(c.denomination) === denom);
      const val = match ? match.total : 0;
      return `<td class="border border-black p-0.5 text-center">${val > 0 ? '£' + val.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '-'}</td>`;
    }).join('');
    
    return `
      <tr class="border-b text-xs hover:bg-gray-50">
        <td class="border border-black p-0.5 whitespace-nowrap font-medium text-gray-900">${new Date(row.date).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric' })}</td>
        ${cells}
      </tr>
    `;
  }).join('');
  
  const denomTotals = DENOMINATIONS.reduce((acc, denom) => {
    const total = weekData.reduce((sum, row) => {
        const match = row.cash_counts?.find(c => Number(c.denomination) === denom);
        return sum + (match ? match.total : 0);
    }, 0);
    acc[denom] = total;
    return acc;
  }, {} as Record<number, number>);

  const denomFooterCells = DENOMINATIONS.map(denom => 
    `<td class="border border-black p-1 text-right font-bold text-[10px]">£${denomTotals[denom].toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>`
  ).join('');

  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <title>Weekly Cashing Up - ${siteName}</title>
      <script src="https://cdn.tailwindcss.com"></script>
      <style>
        body { font-family: sans-serif; -webkit-print-color-adjust: exact; font-size: 10px; }
        @page { size: A4 landscape; margin: 5mm; } /* Reduced margins */
        .header-box { border: 1px solid black; padding: 2px 6px; font-weight: bold; font-size: 0.9rem; display: inline-block; min-width: 150px; }
        table { border-collapse: collapse; width: 100%; }
        th, td { border: 1px solid black; }
        .group-header { background-color: #f3f4f6; font-weight: bold; text-transform: uppercase; text-align: center; font-size: 0.7rem; } /* bg-gray-100 */
        .col-header { font-size: 0.5rem; font-weight: bold; text-align: center; vertical-align: middle; height: 30px; background-color: #f3f4f6; } /* bg-gray-100 */
        .footer-box { border: 1px solid black; height: 24px; width: 150px; display: inline-block; }
      </style>
    </head>
    <body class="p-2 max-w-full mx-auto">
      
      <!-- Header -->
      <div class="flex justify-between items-end mb-4">
        <div class="w-2/3">
          <h1 class="text-xl font-normal mb-2">Weekly Cashing-Up Tracking</h1>
          <div class="flex items-center gap-6">
            <div class="flex items-center gap-2">
              <span class="font-bold text-sm">Date</span>
              <div class="header-box">${formattedDate}</div>
            </div>
            <div class="flex items-center gap-2">
              <span class="font-bold text-sm">Week No.</span>
              <div class="header-box" style="min-width: 40px;">${weekNum}</div>
            </div>
          </div>
        </div>
        <div class="w-1/3 flex justify-end">
          ${logoHtml}
        </div>
      </div>

      <!-- Main Table -->
      <table class="mb-4 border border-black text-[9px]">
        <thead>
          <!-- Group Headers -->
          <tr class="border-b border-black">
            <th class="border-none" colspan="2"></th> <!-- Date Cols -->
            <th class="group-header border border-black" colspan="3">CASH</th>
            <th class="group-header border border-black" colspan="1">CREDIT CARD</th>
            <th class="group-header border border-black" colspan="1">STRIPE</th>
            <th class="group-header border border-black" colspan="3">TOTALS</th>
            <th class="group-header border border-black" colspan="3">TARGETS</th>
            <th class="border-none"></th> <!-- Notes -->
          </tr>
          <!-- Column Headers -->
          <tr class="border-b border-black">
            <th class="col-header px-0.5">Day</th>
            <th class="col-header px-0.5">Week<br>day</th>
            
            <th class="col-header px-0.5">Till Z Report Total</th>
            <th class="col-header px-0.5">Actual Cash Total</th>
            <th class="col-header px-0.5">CASH<br>DISCREPANCY</th>
            
            <th class="col-header px-0.5">Till Z Report Total</th>
            
            <th class="col-header px-0.5">ACTUAL STRIPE TOTAL</th>
            
            <th class="col-header px-0.5">TOTAL EXPECTED</th>
            <th class="col-header px-0.5">TOTAL NET<br>RECEIVED</th>
            <th class="col-header px-0.5">TOTAL DISCREPANCY</th>
            
            <th class="col-header px-0.5">Daily Accumulated<br>Target</th>
            <th class="col-header px-0.5">Weekly<br>Accumulative Total</th>
            <th class="col-header px-0.5">% Target Delivery</th>
            
            <th class="col-header px-0.5 min-w-[80px]">Notes</th>
          </tr>
        </thead>
        <tbody>
          ${rows}
        </tbody>
        <tfoot class="font-bold border-t border-black">
          <tr class="text-[9px] h-6 bg-gray-100">
            <td class="p-0.5 text-center" colspan="2">WEEKLY TOTALS</td>
            <td class="p-0.5 text-right">${formatCurrency(totals.cash_expected)}</td>
            <td class="p-0.5 text-right">${formatCurrency(totals.cash_actual)}</td>
            <td class="p-0.5 text-right">${formatCurrency(totals.cash_variance)}</td>
            <td class="p-0.5 text-right">${formatCurrency(totals.card_expected)}</td>
            <td class="p-0.5 text-right">${formatCurrency(totals.stripe_actual)}</td>
            <td class="p-0.5 text-right">${formatCurrency(totals.total_expected)}</td>
            <td class="p-0.5 text-right">${formatCurrency(totals.total_actual)}</td>
            <td class="p-0.5 text-right">${formatCurrency(totals.total_variance)}</td>
            <td class="p-0.5" colspan="4"></td>
          </tr>
        </tfoot>
      </table>

      <!-- Footer Section -->
      <div class="flex gap-4 items-start mt-2">
        <!-- Left: Footer Inputs -->
        <div class="flex flex-col gap-2 w-1/3 text-xs">
          <div class="flex justify-between items-center">
            <span>Total Cash Held for Petty Cash</span>
            <div class="footer-box"></div>
          </div>
          <div class="flex justify-between items-center">
            <span>Total Cash Held for Change</span>
            <div class="footer-box"></div>
          </div>
          <div class="flex justify-between items-center">
            <span>Bank</span>
            <div class="footer-box"></div>
          </div>
        </div>

        <!-- Right: Denominations Breakdown (New Table) -->
        <div class="w-2/3 pl-4 border-l border-gray-200">
            <h3 class="text-xs font-bold text-gray-800 mb-1">Denominations Breakdown</h3>
            <table class="w-full text-[9px] border-collapse border border-black">
                <thead class="bg-gray-100">
                    <tr>
                        <th class="border border-black p-0.5 w-16">Date</th>
                        ${DENOMINATIONS.map(d => `<th class="border border-black p-0.5 text-center">${d < 1 ? '£' + d.toFixed(2) : '£' + d}</th>`).join('')}
                    </tr>
                </thead>
                <tbody>
                    ${denomRows}
                </tbody>
                <tfoot class="bg-gray-100 font-bold">
                    <tr>
                        <td class="border border-black p-0.5">Totals</td>
                        ${denomFooterCells}
                    </tr>
                </tfoot>
            </table>
        </div>
      </div>

    </body>
    </html>
  `;
}