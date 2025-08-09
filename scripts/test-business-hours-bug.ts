#!/usr/bin/env tsx
/**
 * Test script to reproduce the business hours API bug
 * where venues closing at midnight show as closed when they're open
 */

import { format } from 'date-fns';

// Simulate the current comparison logic from the API
function isOpenCurrentLogic(currentTime: string, opens: string, closes: string): boolean {
  return currentTime >= opens && currentTime < closes;
}

// Fixed logic that handles midnight properly
function isOpenFixedLogic(currentTime: string, opens: string, closes: string): boolean {
  // Handle special case where venue closes at or after midnight
  if (closes <= opens) {
    // Venue closes after midnight (e.g., opens at 12:00, closes at 00:00 or 02:00)
    // We're open if:
    // - Current time is after opening time (same day), OR
    // - Current time is before closing time (technically next day)
    return currentTime >= opens || currentTime < closes;
  }
  
  // Normal case: closes after opens on same day
  return currentTime >= opens && currentTime < closes;
}

// Test cases based on the reported bug
const testCases = [
  // Saturday bar hours: 12:00 - 00:00 (noon to midnight)
  { day: 'Saturday Bar', opens: '12:00:00', closes: '00:00:00', testTimes: [
    { time: '11:30:00', shouldBeOpen: false },
    { time: '12:00:00', shouldBeOpen: true },
    { time: '14:36:00', shouldBeOpen: true }, // This is the reported bug case
    { time: '18:00:00', shouldBeOpen: true },
    { time: '23:59:59', shouldBeOpen: true },
  ]},
  
  // Friday bar hours: 17:00 - 00:00 (5pm to midnight)
  { day: 'Friday Bar', opens: '17:00:00', closes: '00:00:00', testTimes: [
    { time: '16:30:00', shouldBeOpen: false },
    { time: '17:00:00', shouldBeOpen: true },
    { time: '19:00:00', shouldBeOpen: true },
    { time: '23:30:00', shouldBeOpen: true },
  ]},
  
  // Late night venue: 18:00 - 02:00 (6pm to 2am next day)
  { day: 'Late Night', opens: '18:00:00', closes: '02:00:00', testTimes: [
    { time: '17:00:00', shouldBeOpen: false },
    { time: '18:00:00', shouldBeOpen: true },
    { time: '23:00:00', shouldBeOpen: true },
    { time: '00:30:00', shouldBeOpen: true }, // After midnight
    { time: '01:59:00', shouldBeOpen: true }, // Just before closing
    { time: '02:00:00', shouldBeOpen: false }, // Closed
    { time: '12:00:00', shouldBeOpen: false }, // Midday next day
  ]},
  
  // Normal hours: 09:00 - 17:00
  { day: 'Normal Hours', opens: '09:00:00', closes: '17:00:00', testTimes: [
    { time: '08:30:00', shouldBeOpen: false },
    { time: '09:00:00', shouldBeOpen: true },
    { time: '12:00:00', shouldBeOpen: true },
    { time: '16:59:00', shouldBeOpen: true },
    { time: '17:00:00', shouldBeOpen: false },
  ]},
];

console.log('🔍 Testing Business Hours Bug\n');
console.log('=' .repeat(80));

let currentLogicFailures = 0;
let fixedLogicFailures = 0;

for (const testCase of testCases) {
  console.log(`\n📅 ${testCase.day} (${testCase.opens} - ${testCase.closes})`);
  console.log('-'.repeat(60));
  
  for (const test of testCase.testTimes) {
    const currentResult = isOpenCurrentLogic(test.time, testCase.opens, testCase.closes);
    const fixedResult = isOpenFixedLogic(test.time, testCase.opens, testCase.closes);
    
    const currentCorrect = currentResult === test.shouldBeOpen;
    const fixedCorrect = fixedResult === test.shouldBeOpen;
    
    if (!currentCorrect) currentLogicFailures++;
    if (!fixedCorrect) fixedLogicFailures++;
    
    console.log(
      `  ${test.time}: Should be ${test.shouldBeOpen ? 'OPEN' : 'CLOSED'} | ` +
      `Current: ${currentResult ? 'OPEN' : 'CLOSED'} ${currentCorrect ? '✅' : '❌'} | ` +
      `Fixed: ${fixedResult ? 'OPEN' : 'CLOSED'} ${fixedCorrect ? '✅' : '❌'}`
    );
  }
}

console.log('\n' + '='.repeat(80));
console.log('\n📊 Results Summary:');
console.log(`  Current Logic: ${currentLogicFailures} failures`);
console.log(`  Fixed Logic: ${fixedLogicFailures} failures`);

if (currentLogicFailures > 0 && fixedLogicFailures === 0) {
  console.log('\n✅ Fixed logic resolves all test cases!');
} else if (fixedLogicFailures > 0) {
  console.log('\n⚠️ Fixed logic still has issues - needs more work');
}

console.log('\n💡 The fix:');
console.log('  When closing time <= opening time, it means the venue closes after midnight.');
console.log('  In this case, the venue is open if:');
console.log('    - Current time >= opening time (same day), OR');
console.log('    - Current time < closing time (early next day)');