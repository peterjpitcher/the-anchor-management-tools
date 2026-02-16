#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * Create placeholder PWA icons by copying the logo file.
 *
 * Safety:
 * - Fails closed: missing source logo or any write failure sets `process.exitCode = 1`.
 * - Avoids calling `process.exit` so logs flush and callers can test behavior.
 *
 * Usage:
 *   node scripts/create-placeholder-icons.js
 */

const fs = require('fs')
const path = require('path')

const ICON_SIZES = [72, 96, 128, 144, 152, 192, 384, 512]
const SOURCE_LOGO = path.join(process.cwd(), 'public', 'logo.png')
const OUTPUT_DIR = path.join(process.cwd(), 'public')

function errorMessage(error) {
  if (error instanceof Error) {
    return error.message
  }
  return String(error)
}

function copyOrFail({ src, dest, label }) {
  try {
    fs.copyFileSync(src, dest)
    console.log(`✅ Created placeholder: ${label}`)
    return true
  } catch (error) {
    console.error(`❌ Failed to create ${label}:`, errorMessage(error))
    process.exitCode = 1
    return false
  }
}

function main() {
  console.log('Creating placeholder PWA icons...\n')

  if (!fs.existsSync(SOURCE_LOGO)) {
    console.error(`❌ Source logo not found at: ${SOURCE_LOGO}`)
    console.error('Please ensure public/logo.png exists')
    process.exitCode = 1
    return
  }

  console.log(`✅ Source logo found: ${SOURCE_LOGO}`)

  let failures = 0

  for (const size of ICON_SIZES) {
    const label = `icon-${size}x${size}.png`
    const outputPath = path.join(OUTPUT_DIR, label)
    if (!copyOrFail({ src: SOURCE_LOGO, dest: outputPath, label })) {
      failures += 1
    }
  }

  if (
    !copyOrFail({
      src: SOURCE_LOGO,
      dest: path.join(OUTPUT_DIR, 'apple-touch-icon.png'),
      label: 'apple-touch-icon.png',
    })
  ) {
    failures += 1
  }

  for (const size of [16, 32]) {
    const label = `favicon-${size}x${size}.png`
    const outputPath = path.join(OUTPUT_DIR, label)
    if (!copyOrFail({ src: SOURCE_LOGO, dest: outputPath, label })) {
      failures += 1
    }
  }

  if (failures > 0) {
    console.error(`\n⚠️ Placeholder icon creation completed with ${failures} failure(s).`)
    process.exitCode = 1
    return
  }

  console.log('\n✨ Placeholder icon creation complete!')
  console.log('📝 Icons have been saved to the public directory')
  console.log('⚠️  Note: These are placeholder icons using the full logo.')
  console.log('   For production, generate properly sized icons.')
}

try {
  main()
} catch (error) {
  console.error('❌ Placeholder icon creation failed:', errorMessage(error))
  process.exitCode = 1
}
