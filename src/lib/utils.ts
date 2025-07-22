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

export function generatePhoneVariants(phone: string): string[] {
  const variants = [phone];
  
  // Clean the phone number - remove all non-digits except leading +
  const cleaned = phone.replace(/[^\d+]/g, '').replace(/\+/g, (match, offset) => offset === 0 ? match : '');
  const digitsOnly = cleaned.replace(/^\+/, '');
  
  // UK number handling
  if (cleaned.startsWith('+44') && digitsOnly.length >= 12) {
    const ukNumber = digitsOnly.substring(2); // Remove 44 from the digits
    variants.push('+44' + ukNumber);
    variants.push('44' + ukNumber);
    variants.push('0' + ukNumber);
  } else if (digitsOnly.startsWith('44') && digitsOnly.length >= 12) {
    const ukNumber = digitsOnly.substring(2); // Remove 44
    variants.push('+44' + ukNumber);
    variants.push('44' + ukNumber);
    variants.push('0' + ukNumber);
  } else if (digitsOnly.startsWith('0') && digitsOnly.length === 11) {
    const ukNumber = digitsOnly.substring(1); // Remove 0
    variants.push('+44' + ukNumber);
    variants.push('44' + ukNumber);
    variants.push('0' + ukNumber);
  }
  
  // Also add the cleaned version if different from original
  if (cleaned !== phone) {
    variants.push(cleaned);
  }
  
  return [...new Set(variants)];
}

export function generateSlug(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-+/g, '-')
}

export function formatPhoneForStorage(phone: string): string {
  // Clean the phone number - remove all non-digits except leading +
  const cleaned = phone.replace(/[^\d+]/g, '').replace(/\+/g, (match, offset) => offset === 0 ? match : '');
  const digitsOnly = cleaned.replace(/^\+/, '');
  
  // Convert UK numbers to E164 format
  if (digitsOnly.startsWith('44') && digitsOnly.length >= 12) {
    return '+' + digitsOnly;
  } else if (digitsOnly.startsWith('0') && digitsOnly.length === 11) {
    // UK number starting with 0
    return '+44' + digitsOnly.substring(1);
  } else if (cleaned.startsWith('+')) {
    return cleaned;
  } else {
    // Default to adding UK code if no country code
    return '+44' + digitsOnly.replace(/^0/, '');
  }
}