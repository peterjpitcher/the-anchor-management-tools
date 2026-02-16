#!/usr/bin/env tsx

import dotenv from 'dotenv';
import path from 'path';
import { promises as fs } from 'fs';

dotenv.config({ path: '.env.local' });

async function main() {
  const apiKey =
    process.env.TEST_API_KEY ||
    process.env.API_KEY ||
    process.env.ANCHOR_API_KEY;

  if (!apiKey) {
    throw new Error('Missing API key. Set TEST_API_KEY in .env.local.')
  }

  const baseUrl = process.env.API_BASE_URL || 'http://localhost:3000';

  const query = process.env.EVENTS_QUERY || 'limit=100';
  const url = new URL('/api/events', baseUrl);
  if (query) {
    url.search = query.startsWith('?') ? query : `?${query}`;
  }

  const tempDir = path.resolve(process.cwd(), 'temp');
  await fs.mkdir(tempDir, { recursive: true });

  const outputFile = process.env.EVENTS_OUTPUT_FILE
    ? (path.isAbsolute(process.env.EVENTS_OUTPUT_FILE)
        ? process.env.EVENTS_OUTPUT_FILE
        : path.resolve(process.cwd(), process.env.EVENTS_OUTPUT_FILE))
    : path.join(tempDir, 'events-api-response.json');

  const response = await fetch(url.toString(), {
    headers: {
      Accept: 'application/json',
      'X-API-Key': apiKey,
      Authorization: `Bearer ${apiKey}`,
    },
  });

  const bodyText = await response.text();
  let output = bodyText;

  try {
    const json = JSON.parse(bodyText);
    output = JSON.stringify(json, null, 2);
  } catch {
    // Keep raw response if it is not valid JSON.
  }

  await fs.writeFile(outputFile, output, 'utf8');

  console.log(`Saved response to ${outputFile}`);
  console.log(`Status: ${response.status}`);
  console.log(`URL: ${url.toString()}`);

  if (!response.ok) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error('Request failed:', error);
  process.exitCode = 1;
});
