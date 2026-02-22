import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import {
  formatPhoneForStorage as normalizePhoneForStorage,
  generatePhoneVariants as buildPhoneVariants
} from '@/lib/phone';

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

export function generateSlug(text: string): string {
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

export function formatDate(date: string | Date | null): string {
  if (!date) return '-'
  return new Date(date).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric'
  })
}
