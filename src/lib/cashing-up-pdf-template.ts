import { CashupWeeklyView } from '@/types/cashing-up';

interface TemplateProps {
  weekData: CashupWeeklyView[];
  siteName: string;
  weekStartDate: string;
  logoUrl?: string;
}

export function generateWeeklyCashupHTML({ weekData, siteName, weekStartDate, logoUrl }: TemplateProps): string {
  const logoHtml = logoUrl 
    ? `<img src="${logoUrl}" alt="Logo" class="h-12 mb-4" />` 
    : '<h1 class="text-2xl font-bold mb-4">The Anchor</h1>';

  const rows = weekData.map(row => `
    <tr class="border-b">
      <td class="py-2 px-4">${row.session_date}</td>
      <td class="py-2 px-4">${row.shift_code || '-'}</td>
      <td class="py-2 px-4 capitalize">${row.status}</td>
      <td class="py-2 px-4 text-right">£${row.total_expected_amount.toFixed(2)}</td>
      <td class="py-2 px-4 text-right">£${row.total_counted_amount.toFixed(2)}</td>
      <td class="py-2 px-4 text-right font-bold ${row.total_variance_amount < 0 ? 'text-red-600' : 'text-green-600'}">
        £${row.total_variance_amount.toFixed(2)}
      </td>
    </tr>
  `).join('');

  const totalExpected = weekData.reduce((acc, r) => acc + r.total_expected_amount, 0);
  const totalCounted = weekData.reduce((acc, r) => acc + r.total_counted_amount, 0);
  const totalVariance = weekData.reduce((acc, r) => acc + r.total_variance_amount, 0);

  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <title>Weekly Cashing Up - ${siteName}</title>
      <script src="https://cdn.tailwindcss.com"></script>
      <style>
        body { font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif; }
        @media print {
          .no-print { display: none; }
          body { -webkit-print-color-adjust: exact; }
        }
      </style>
    </head>
    <body class="p-8 max-w-4xl mx-auto">
      <div class="mb-8">
        ${logoHtml}
        <h2 class="text-xl font-bold">Weekly Cashing Up Breakdown</h2>
        <p class="text-gray-600">Site: <span class="font-semibold text-gray-900">${siteName}</span></p>
        <p class="text-gray-600">Week Commencing: <span class="font-semibold text-gray-900">${weekStartDate}</span></p>
      </div>

      <table class="w-full text-sm text-left text-gray-500 mb-8">
        <thead class="text-xs text-gray-700 uppercase bg-gray-50 border-b">
          <tr>
            <th class="px-4 py-3">Date</th>
            <th class="px-4 py-3">Shift</th>
            <th class="px-4 py-3">Status</th>
            <th class="px-4 py-3 text-right">Expected</th>
            <th class="px-4 py-3 text-right">Counted</th>
            <th class="px-4 py-3 text-right">Variance</th>
          </tr>
        </thead>
        <tbody>
          ${rows}
        </tbody>
        <tfoot class="bg-gray-50 font-bold text-gray-900">
          <tr>
            <td colspan="3" class="px-4 py-3 text-right">Weekly Totals:</td>
            <td class="px-4 py-3 text-right">£${totalExpected.toFixed(2)}</td>
            <td class="px-4 py-3 text-right">£${totalCounted.toFixed(2)}</td>
            <td class="px-4 py-3 text-right ${totalVariance < 0 ? 'text-red-600' : 'text-green-600'}">£${totalVariance.toFixed(2)}</td>
          </tr>
        </tfoot>
      </table>

      <div class="text-xs text-gray-400 text-center mt-12">
        Generated on ${new Date().toLocaleString()}
      </div>
    </body>
    </html>
  `;
}
