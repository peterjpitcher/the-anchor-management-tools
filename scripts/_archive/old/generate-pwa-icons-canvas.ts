#!/usr/bin/env tsx
/**
 * Generate PWA Icons Script (Canvas version)
 * 
 * This script generates all required PWA icon sizes from a source logo image.
 * Uses canvas for image manipulation to avoid sharp dependency issues.
 * 
 * Usage: tsx scripts/generate-pwa-icons-canvas.ts
 */

import { createCanvas, loadImage } from 'canvas';
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

  // Load the source image
  const image = await loadImage(SOURCE_LOGO);

  // Generate icons for each size
  for (const size of ICON_SIZES) {
    const canvas = createCanvas(size, size);
    const ctx = canvas.getContext('2d');
    
    // Fill background with #005131
    ctx.fillStyle = '#005131';
    ctx.fillRect(0, 0, size, size);
    
    // Calculate scaling to fit image
    const scale = Math.min(size / image.width, size / image.height) * 0.8; // 0.8 for padding
    const scaledWidth = image.width * scale;
    const scaledHeight = image.height * scale;
    const x = (size - scaledWidth) / 2;
    const y = (size - scaledHeight) / 2;
    
    // Draw the image
    ctx.drawImage(image, x, y, scaledWidth, scaledHeight);
    
    // Save to file
    const outputPath = path.join(OUTPUT_DIR, `icon-${size}x${size}.png`);
    const buffer = canvas.toBuffer('image/png');
    await fs.writeFile(outputPath, buffer);
    
    console.log(`✅ Generated: icon-${size}x${size}.png`);
  }

  // Also generate apple-touch-icon
  const appleSize = 180;
  const appleCanvas = createCanvas(appleSize, appleSize);
  const appleCtx = appleCanvas.getContext('2d');
  
  appleCtx.fillStyle = '#005131';
  appleCtx.fillRect(0, 0, appleSize, appleSize);
  
  const appleScale = Math.min(appleSize / image.width, appleSize / image.height) * 0.8;
  const appleScaledWidth = image.width * appleScale;
  const appleScaledHeight = image.height * appleScale;
  const appleX = (appleSize - appleScaledWidth) / 2;
  const appleY = (appleSize - appleScaledHeight) / 2;
  
  appleCtx.drawImage(image, appleX, appleY, appleScaledWidth, appleScaledHeight);
  
  const appleBuffer = appleCanvas.toBuffer('image/png');
  await fs.writeFile(path.join(OUTPUT_DIR, 'apple-touch-icon.png'), appleBuffer);
  console.log('✅ Generated: apple-touch-icon.png');

  // Generate favicon-32x32 and favicon-16x16 for better browser support
  for (const size of [16, 32]) {
    const faviconCanvas = createCanvas(size, size);
    const faviconCtx = faviconCanvas.getContext('2d');
    
    faviconCtx.fillStyle = '#005131';
    faviconCtx.fillRect(0, 0, size, size);
    
    const faviconScale = Math.min(size / image.width, size / image.height) * 0.8;
    const faviconScaledWidth = image.width * faviconScale;
    const faviconScaledHeight = image.height * faviconScale;
    const faviconX = (size - faviconScaledWidth) / 2;
    const faviconY = (size - faviconScaledHeight) / 2;
    
    faviconCtx.drawImage(image, faviconX, faviconY, faviconScaledWidth, faviconScaledHeight);
    
    const faviconBuffer = faviconCanvas.toBuffer('image/png');
    await fs.writeFile(path.join(OUTPUT_DIR, `favicon-${size}x${size}.png`), faviconBuffer);
    console.log(`✅ Generated: favicon-${size}x${size}.png`);
  }

  console.log('\n✨ Icon generation complete!');
  console.log('📝 Icons have been saved to the public directory');
  console.log('🔄 The manifest.json already references these icons');
}

// Run the script
generateIcons().catch(console.error);