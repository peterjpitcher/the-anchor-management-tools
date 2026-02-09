import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

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

const DEFAULT_COUNTRY_CODE = '44';
const E164_MIN_DIGITS = 8;
const E164_MAX_DIGITS = 15;

function sanitizePhoneInput(phone: string): string {
  const trimmed = phone.trim();
  if (!trimmed) return '';

  let normalized = trimmed.replace(/[^\d+]/g, '');
  normalized = normalized.replace(/(?!^)\+/g, '');

  if (normalized.startsWith('00')) {
    normalized = `+${normalized.slice(2)}`;
  }

  return normalized;
}

function sanitizeCountryCode(defaultCountryCode?: string): string {
  const digitsOnly = (defaultCountryCode ?? DEFAULT_COUNTRY_CODE).replace(/\D/g, '');
  return digitsOnly || DEFAULT_COUNTRY_CODE;
}

function assertE164Digits(digits: string): void {
  if (!/^\d+$/.test(digits)) {
    throw new Error('Invalid phone number format');
  }

  if (digits.startsWith('0')) {
    throw new Error('Invalid phone number format');
  }

  if (digits.length < E164_MIN_DIGITS || digits.length > E164_MAX_DIGITS) {
    throw new Error('Invalid phone number format');
  }
}

export function formatPhoneForStorage(
  phone: string,
  options: { defaultCountryCode?: string } = {}
): string {
  const cleaned = sanitizePhoneInput(phone);
  if (!cleaned) {
    throw new Error('Invalid phone number format');
  }

  const defaultCountryCode = sanitizeCountryCode(options.defaultCountryCode);
  let digits = '';

  if (cleaned.startsWith('+')) {
    digits = cleaned.slice(1);
  } else {
    const localDigits = cleaned.replace(/\D/g, '');
    if (!localDigits) {
      throw new Error('Invalid phone number format');
    }

    if (localDigits.startsWith(defaultCountryCode)) {
      digits = localDigits;
    } else if (localDigits.startsWith('0')) {
      digits = `${defaultCountryCode}${localDigits.replace(/^0+/, '')}`;
    } else {
      digits = `${defaultCountryCode}${localDigits}`;
    }
  }

  assertE164Digits(digits);
  return `+${digits}`;
}

export function generatePhoneVariants(
  phone: string,
  options: { defaultCountryCode?: string } = {}
): string[] {
  const variants = new Set<string>();
  const raw = phone.trim();
  const cleaned = sanitizePhoneInput(phone);

  if (raw) {
    variants.add(raw);
  }

  if (cleaned) {
    variants.add(cleaned);
    const cleanedDigits = cleaned.replace(/^\+/, '');
    if (cleanedDigits) {
      variants.add(cleanedDigits);
      variants.add(`+${cleanedDigits}`);
      variants.add(`00${cleanedDigits}`);
    }
  }

  try {
    const canonical = formatPhoneForStorage(phone, options);
    variants.add(canonical);

    const canonicalDigits = canonical.slice(1);
    variants.add(canonicalDigits);
    variants.add(`00${canonicalDigits}`);

    if (canonical.startsWith('+44')) {
      const ukNational = canonical.slice(3);
      variants.add(`44${ukNational}`);
      variants.add(`0${ukNational}`);
    }
  } catch {
    // Keep whatever variants we can infer from raw input when normalization fails.
  }

  return [...variants];
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
