# SMS Reminder System Investigation Report

## Issue Summary
The SMS reminder system has been sending incorrect "tomorrow" messages for Bingo Night events scheduled for Friday, Sept 19, 2025. Messages saying "Bingo is tomorrow" were sent on Thursday (Sept 12), which is 6 days early, and duplicate messages were sent again this morning (Saturday, Sept 13).

## Root Cause Analysis

### 1. **Dual SMS System Conflict**
The application runs TWO separate SMS reminder systems simultaneously:

#### **New System** (src/app/actions/sms-event-reminders.ts)
- Uses `booking_reminders` table for scheduled reminders
- Has proper date validation (lines 77-100): skips events in the past
- Processes reminders based on `scheduled_for` timestamp
- More sophisticated with multiple reminder types

#### **Legacy System** (src/app/actions/sms.ts, lines 283-449)
- Function `sendEventReminders()` 
- Uses hardcoded date calculations: tomorrow and "next week"
- **CRITICAL FLAW**: The logic assumes "tomorrow" means the day after today, but doesn't validate if that's the actual event date

### 2. **The Specific Problem**
In the legacy system (line 315):
```typescript
.in('event.date', [tomorrowStr, nextWeekStr])
```

This queries for events on:
- Tomorrow (Sept 13)
- Next week (Sept 19) 

But the message template logic (lines 401, 438-444) incorrectly says "tomorrow" for ANY event found in the query, even if it's actually next week.

### 3. **Database Evidence**
From investigation queries:
- **Bingo Night event**: Scheduled for 2025-09-19 (Friday)
- **Incorrect reminders sent**: Sept 12 at 09:00 with "tomorrow" messages
- **Status inconsistency**: Reminders show `status: 'pending'` but `sent_at` is populated
- **Template type mismatch**: Using `7_day` reminder type but sending "tomorrow" messages

## Timeline of the Problem

1. **Sept 12, 09:00**: Legacy system runs via cron job `/api/cron/reminders/route.ts`
2. **Query execution**: Finds Bingo Night (Sept 19) as it's "next week" from Sept 12
3. **Template logic error**: Incorrectly identifies it as "next day" event
4. **Message sent**: "Bingo Night is tomorrow at 19:00" (wrong!)
5. **Today (Sept 13)**: System runs again, finds same event, sends duplicate

## Technical Issues Identified

### 1. **Date Calculation Logic Error**
In `sendEventReminders()` function:
- `isNextDay` check (line 401) compares event date to `tomorrowStr`
- For Bingo (Sept 19), this returns `false` correctly 
- BUT the template selection logic is flawed

### 2. **Template Selection Bug**
Lines 438-444 in legacy system:
```typescript
message = isNextDay
  ? smsTemplates.dayBeforeReminder({...}) // "tomorrow" message
  : smsTemplates.weekBeforeReminder({...}) // week before message
```
The logic should use week before template, but somewhere the "tomorrow" template is being used.

### 3. **Concurrent System Execution**
Route `/api/cron/reminders/route.ts` calls BOTH systems:
- `processScheduledEventReminders()` (new system)
- `sendEventReminders()` (legacy system)

This creates potential for duplicate messages and conflicts.

## Immediate Risk Assessment

### **CRITICAL**
- **Customer embarrassment**: Customers receiving incorrect "tomorrow" messages
- **Business credibility**: Confusing communications damage trust
- **Staff workload**: Handling customer complaints about wrong messages

### **HIGH**  
- **Duplicate messages**: Same customers getting multiple conflicting messages
- **System reliability**: Two systems with different logic creating inconsistency

## Recommendations

### **Immediate Actions (Priority 1)**
1. **Disable legacy system temporarily**
   - Comment out `await sendEventReminders()` in `/api/cron/reminders/route.ts` (line 28)
   - This prevents further incorrect messages while keeping the new system running

2. **Database cleanup**
   - Update incorrect reminder records to `status: 'cancelled'` 
   - Clear any "pending" reminders that have already been sent

### **Short-term Fix (Priority 2)**
1. **Fix legacy template logic**
   - The `isNextDay` calculation appears correct
   - Issue is likely in template variables or SMS template selection
   - Need to trace why "tomorrow" message is used for 7-day reminders

2. **Add better logging**
   - Log which template is being used for each message
   - Add date validation debug information

### **Long-term Solution (Priority 3)**
1. **Migrate fully to new system**
   - New system has better date validation and scheduling
   - Remove legacy `sendEventReminders()` function entirely
   - Ensure all events have proper `booking_reminders` entries

2. **Add safeguards**
   - Implement date validation in all SMS templates
   - Add "dry run" mode for testing reminder logic
   - Create monitoring for duplicate/incorrect messages

### **Testing Protocol**
Before any changes:
1. **Run investigation script**: Use existing `check-reminder-issues.ts`
2. **Test date calculations**: Verify tomorrow/next week logic in non-prod
3. **Message template validation**: Ensure correct templates are used
4. **Customer impact assessment**: Check how many were affected

## Files Requiring Changes

### **Immediate**
- `/src/app/api/cron/reminders/route.ts` - Disable legacy system
- Database cleanup script needed

### **Short-term**  
- `/src/app/actions/sms.ts` - Fix template logic in `sendEventReminders()`
- SMS template validation

### **Long-term**
- Remove legacy system entirely
- Migrate to new `booking_reminders` system fully

## Conclusion
The SMS reminder issue is caused by a logical flaw in the legacy reminder system that incorrectly identifies events as "tomorrow" when they are actually next week. The immediate solution is to disable the problematic legacy system and rely on the newer, more accurate system. A proper fix requires either correcting the legacy template logic or fully migrating to the new system.

**Recommendation**: Disable legacy system immediately to prevent further customer embarrassment, then plan proper migration to the new system.