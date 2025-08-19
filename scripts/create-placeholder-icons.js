#!/usr/bin/env node
/**
 * Create Placeholder Icons Script
 * 
 * This script creates placeholder icons by copying the logo file.
 * This is a temporary solution until proper icon generation is implemented.
 * 
 * Usage: node scripts/create-placeholder-icons.js
 */

const fs = require('fs');
const path = require('path');

const ICON_SIZES = [72, 96, 128, 144, 152, 192, 384, 512];
const SOURCE_LOGO = path.join(process.cwd(), 'public', 'logo.png');
const OUTPUT_DIR = path.join(process.cwd(), 'public');

console.log('🎨 Creating placeholder PWA icons...\n');

// Check if source logo exists
if (!fs.existsSync(SOURCE_LOGO)) {
  console.error(`❌ Source logo not found at: ${SOURCE_LOGO}`);
  console.error('Please ensure public/logo.png exists');
  process.exit(1);
}

console.log(`✅ Source logo found: ${SOURCE_LOGO}`);

// Copy logo as placeholder for each icon size
for (const size of ICON_SIZES) {
  const outputPath = path.join(OUTPUT_DIR, `icon-${size}x${size}.png`);
  
  try {
    fs.copyFileSync(SOURCE_LOGO, outputPath);
    console.log(`✅ Created placeholder: icon-${size}x${size}.png`);
  } catch (error) {
    console.error(`❌ Failed to create icon-${size}x${size}.png:`, error.message);
  }
}

// Also create apple-touch-icon
try {
  fs.copyFileSync(SOURCE_LOGO, path.join(OUTPUT_DIR, 'apple-touch-icon.png'));
  console.log('✅ Created placeholder: apple-touch-icon.png');
} catch (error) {
  console.error('❌ Failed to create apple-touch-icon:', error.message);
}

// Create favicon placeholders
for (const size of [16, 32]) {
  try {
    fs.copyFileSync(SOURCE_LOGO, path.join(OUTPUT_DIR, `favicon-${size}x${size}.png`));
    console.log(`✅ Created placeholder: favicon-${size}x${size}.png`);
  } catch (error) {
    console.error(`❌ Failed to create favicon-${size}x${size}.png:`, error.message);
  }
}

console.log('\n✨ Placeholder icon creation complete!');
console.log('📝 Icons have been saved to the public directory');
console.log('⚠️  Note: These are placeholder icons using the full logo.');
console.log('   For production, generate properly sized icons.');