#!/usr/bin/env tsx
/**
 * Generate PWA Icons Script
 * 
 * This script generates all required PWA icon sizes from a source logo image.
 * It creates properly sized icons for the web app manifest.
 * 
 * Usage: tsx scripts/generate-pwa-icons.ts
 */

import sharp from 'sharp';
import { promises as fs } from 'fs';
import path from 'path';

const ICON_SIZES = [72, 96, 128, 144, 152, 192, 384, 512];
const SOURCE_LOGO = path.join(process.cwd(), 'public', 'logo.png');
const OUTPUT_DIR = path.join(process.cwd(), 'public');

async function generateIcons() {
  console.log('🎨 Generating PWA icons from logo...\n');

  try {
    // Check if source logo exists
    await fs.access(SOURCE_LOGO);
    console.log(`✅ Source logo found: ${SOURCE_LOGO}`);
  } catch (error) {
    console.error(`❌ Source logo not found at: ${SOURCE_LOGO}`);
    console.error('Please ensure public/logo.png exists');
    process.exit(1);
  }

  // Generate icons for each size
  for (const size of ICON_SIZES) {
    const outputPath = path.join(OUTPUT_DIR, `icon-${size}x${size}.png`);
    
    try {
      await sharp(SOURCE_LOGO)
        .resize(size, size, {
          fit: 'contain',
          background: { r: 0, g: 81, b: 49, alpha: 1 } // #005131 background
        })
        .png()
        .toFile(outputPath);
      
      console.log(`✅ Generated: icon-${size}x${size}.png`);
    } catch (error) {
      console.error(`❌ Failed to generate icon-${size}x${size}.png:`, error);
    }
  }

  // Also generate apple-touch-icon
  try {
    await sharp(SOURCE_LOGO)
      .resize(180, 180, {
        fit: 'contain',
        background: { r: 0, g: 81, b: 49, alpha: 1 }
      })
      .png()
      .toFile(path.join(OUTPUT_DIR, 'apple-touch-icon.png'));
    
    console.log('✅ Generated: apple-touch-icon.png');
  } catch (error) {
    console.error('❌ Failed to generate apple-touch-icon:', error);
  }

  // Generate favicon-32x32 and favicon-16x16 for better browser support
  for (const size of [16, 32]) {
    try {
      await sharp(SOURCE_LOGO)
        .resize(size, size, {
          fit: 'contain',
          background: { r: 0, g: 81, b: 49, alpha: 1 }
        })
        .png()
        .toFile(path.join(OUTPUT_DIR, `favicon-${size}x${size}.png`));
      
      console.log(`✅ Generated: favicon-${size}x${size}.png`);
    } catch (error) {
      console.error(`❌ Failed to generate favicon-${size}x${size}.png:`, error);
    }
  }

  console.log('\n✨ Icon generation complete!');
  console.log('📝 Icons have been saved to the public directory');
  console.log('🔄 The manifest.json already references these icons');
}

// Run the script
generateIcons().catch(console.error);