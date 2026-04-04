'use client';

import { useEffect } from 'react';

/**
 * Moves the print content to a direct child of <body> before printing.
 *
 * Why: `position: fixed` elements repeat on every printed page in Chrome/Safari.
 * The authenticated layout generates extra document height (nav, sidebar) which
 * causes extra pages — and the fixed overlay prints on each one.
 *
 * By moving the content to body-level and using `display: none` on everything
 * else, the browser sees only one block of content in normal document flow,
 * and paginates it correctly without repetition.
 */
export default function PrintTrigger() {
  useEffect(() => {
    const content = document.querySelector('.rota-print-content') as HTMLElement | null;

    if (content && content.parentElement !== document.body) {
      document.body.appendChild(content); // moves (not clones) into body
    }

    // Inject print styles targeting the restructured DOM
    const style = document.createElement('style');
    style.dataset.rotaPrint = 'true';
    style.textContent = `
      @media print {
        @page { size: A4 landscape; margin: 8mm 6mm; }
        /* Hide everything in body except our content */
        body > *:not(.rota-print-content) { display: none !important; }
        /* Restore to normal flow so content paginates correctly */
        .rota-print-content {
          position: static !important;
          inset: auto !important;
          z-index: auto !important;
          overflow: visible !important;
          background: white !important;
          height: auto !important;
        }
        .no-print { display: none !important; }
        body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      }
    `;
    document.head.appendChild(style);

    const t = setTimeout(() => { window.print(); }, 500);

    return () => {
      clearTimeout(t);
      style.remove();
    };
  }, []);

  return (
    <button type="button"
      onClick={() => window.print()}
      style={{
        padding: '8px 18px',
        backgroundColor: '#2563eb',
        color: '#fff',
        border: 'none',
        borderRadius: 6,
        cursor: 'pointer',
        fontSize: 13,
        fontWeight: 600,
      }}
    >
      🖨 Print / Save as PDF
    </button>
  );
}
