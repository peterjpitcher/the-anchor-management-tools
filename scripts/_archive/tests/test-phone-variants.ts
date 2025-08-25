// Test script for phone number variant generation

function generatePhoneVariants(phone: string): string[] {
  const variants = [phone];
  const digitsOnly = phone.replace(/\D/g, '');
  
  // UK number handling
  if (phone.startsWith('+44') || digitsOnly.startsWith('44')) {
    // Issue: When phone is +447123456789, digitsOnly is 447123456789
    // digitsOnly.substring(2) would be 7123456789, but we want the full number after 44
    const ukNumber = digitsOnly.startsWith('44') ? digitsOnly.substring(2) : digitsOnly;
    variants.push('+44' + ukNumber);
    variants.push('44' + ukNumber);
    variants.push('0' + ukNumber);
  }
  
  if (phone.startsWith('0')) {
    variants.push('+44' + phone.substring(1));
    variants.push('44' + phone.substring(1));
  }
  
  return [...new Set(variants)];
}

// Fixed version
function generatePhoneVariantsFixed(phone: string): string[] {
  const variants = [phone];
  const digitsOnly = phone.replace(/\D/g, '');
  
  // UK number handling
  if (phone.startsWith('+44')) {
    const ukNumber = phone.substring(3); // Remove +44
    variants.push('+44' + ukNumber);
    variants.push('44' + ukNumber);
    variants.push('0' + ukNumber);
  } else if (phone.startsWith('44') && digitsOnly.length >= 12) {
    const ukNumber = phone.substring(2); // Remove 44
    variants.push('+44' + ukNumber);
    variants.push('44' + ukNumber);
    variants.push('0' + ukNumber);
  } else if (phone.startsWith('0') && digitsOnly.length === 11) {
    const ukNumber = phone.substring(1); // Remove 0
    variants.push('+44' + ukNumber);
    variants.push('44' + ukNumber);
    variants.push('0' + ukNumber);
  }
  
  return [...new Set(variants)];
}

// Test cases
const testNumbers = [
  '+447123456789',
  '447123456789',
  '07123456789',
  '+44 7123 456789',
  '0044 7123 456789'
];

console.log('Testing original generatePhoneVariants:');
testNumbers.forEach(num => {
  console.log(`\nInput: "${num}"`);
  const variants = generatePhoneVariants(num);
  console.log('Variants:', variants);
});

console.log('\n\nTesting fixed generatePhoneVariants:');
testNumbers.forEach(num => {
  console.log(`\nInput: "${num}"`);
  const variants = generatePhoneVariantsFixed(num);
  console.log('Variants:', variants);
});

// Test the lookup condition builder
function buildOrConditions(phoneVariants: string[]): string {
  return phoneVariants.map(variant => `mobile_number.eq.${variant}`).join(',');
}

console.log('\n\nTesting OR conditions for Supabase:');
const exampleVariants = generatePhoneVariantsFixed('+447123456789');
console.log('Variants:', exampleVariants);
console.log('OR condition:', buildOrConditions(exampleVariants));