import { clsx, type ClassValue } from 'clsx';
import { extendTailwindMerge } from 'tailwind-merge';
import {
  formatPhoneForStorage as normalizePhoneForStorage,
  generatePhoneVariants as buildPhoneVariants
} from '@/lib/phone';

// tailwind-merge only knows Tailwind's default scale. Without this it reads custom tokens
// such as shadow-ring or rounded-pill as colours, keeps two conflicting classes, and lets
// whichever Tailwind emits last win: that is how every DS field in an error state showed
// the green focus halo instead of the red one (audit, 18 Sep 2026). Keep these lists in
// step with the @theme block in src/app/globals.css.
const twMerge = extendTailwindMerge({
  extend: {
    theme: {
      text: ['2xs', 'meta', 'ui', 'guest-lead'],
      radius: ['default', 'pill', 'guest-field', 'guest-card'],
      shadow: ['default', 'ring', 'ring-inset', 'guest-card', 'guest-gold', 'guest-focus'],
      spacing: [
        'cell-y', 'input-h', 'btn-h', 'btn-h-sm', 'btn-h-lg', 'sidebar-expanded', 'sidebar-collapsed',
        'topbar', 'logo-row', 'pad-card', 'page-shell-pad-y', 'touch', 'shell-pad-top', 'shell-pad-x',
        'shell-pad-bottom',
      ],
      ease: ['default'],
      breakpoint: ['shell'],
      container: ['guest'],
    },
  },
});

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatBytes(bytes: number, decimals = 2): string {
  if (!+bytes) return '0 Bytes'; // Changed from bytes === 0 to !+bytes to handle null/undefined/NaN

  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB'];

  const i = Math.floor(Math.log(bytes) / Math.log(k));

  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`;
}

export function formatPhoneForStorage(
  phone: string,
  options: { defaultCountryCode?: string } = {}
): string {
  return normalizePhoneForStorage(phone, options);
}

export function generatePhoneVariants(
  phone: string,
  options: { defaultCountryCode?: string } = {}
): string[] {
  return buildPhoneVariants(phone, options);
}

function generateSlug(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-+/g, '-')
}

export function sanitizeMoneyString(value: unknown): string | null {
  if (value === null || value === undefined) return null
  const raw = typeof value === 'number' ? value.toString() : String(value)
  const trimmed = raw.trim()
  if (!trimmed) return null
  const normalised = trimmed.replace(/,/g, '')
  const match = normalised.match(/-?\d+(?:\.\d+)?/)
  return match ? match[0] : null
}

function formatDate(date: string | Date | null): string {
  if (!date) return '-'
  return new Date(date).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric'
  })
}
