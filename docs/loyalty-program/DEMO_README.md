# The Anchor VIPs - Loyalty Demo Guide

## Overview

This is a fully functional demo of The Anchor's loyalty program. The demo uses mock data and doesn't make any database changes, allowing you to safely explore all features.

## Demo Access Points

### 🏠 Main Demo Hub
**URL:** `/loyalty/demo`  
Central landing page with links to all demo features and test instructions.

### 📱 Customer Check-in
**URL:** `/loyalty/checkin`  
Where customers scan the event QR code and check themselves in.

### 🏆 Customer Loyalty Dashboard  
**URL:** `/loyalty?phone=07700900001`  
Customer portal showing points, achievements, and rewards.

### 🏪 Staff Redemption Terminal
**URL:** `/loyalty/redeem`  
Staff interface for processing reward redemptions.

### 🎪 Event QR Generator
**URL:** `/loyalty/event-qr`  
Generate and print QR codes for events (staff access).

## Test Data

### Test Phone Numbers
- **Sarah Johnson** (Silver VIP): `07700900001`
  - 1,850 available points
  - 12 lifetime events
  - Has quiz, karaoke, and event explorer achievements
  
- **Mike Williams** (Bronze VIP): `07700900002`
  - 650 available points
  - 6 lifetime events
  - Has loyal customer achievement
  
- **Emma Davis** (Gold VIP): `07700900003`
  - 2,700 available points
  - 24 lifetime events
  - Has all achievements unlocked

### Today's Demo Event
- **Event:** Quiz Night
- **Date:** December 13, 2024
- **Time:** 7:00 PM - 9:00 PM

## Key Features Demonstrated

### 1. Self-Service Check-in
- Customers scan a single QR code per event
- System identifies them by phone number from booking
- Points awarded automatically based on tier
- Achievements unlock in real-time

### 2. Tier System
- **🌟 VIP Member** (0 events): 50 points per attendance
- **🥉 VIP Bronze** (5+ events): 100 points per attendance
- **🥈 VIP Silver** (10+ events): 150 points per attendance
- **🥇 VIP Gold** (20+ events): 200 points per attendance
- **💎 VIP Platinum** (40+ events): 300 points per attendance

### 3. Reward Redemption
- Customers generate time-limited codes (5 minutes)
- Each code has a unique prefix (SNK for snacks, DES for desserts, etc.)
- Codes displayed as both text and QR for flexibility
- Staff can enter code manually or scan QR

### 4. Achievement System
- 🧠 **Quiz Regular**: Attend 5 quiz nights (100 points)
- 🎤 **Karaoke Star**: Perform at karaoke 3 times (75 points)
- 🎯 **Event Explorer**: Try 3 different event types (150 points)
- 🎉 **Weekend Warrior**: Attend 5 weekend events (100 points)
- ⭐ **Loyal Customer**: Attend 10 events (200 points)

### 5. Rewards Catalog
- **300 points**: House Snack
- **400 points**: Free Dessert
- **500 points**: Drink Upgrade (Bronze+ only)
- **600 points**: Free Drink (Silver+ only)
- **750 points**: Bring a Friend (Silver+ only)
- **1000 points**: £10 Credit (Gold+ only)

## Demo Walkthrough

### Step 1: Customer Check-in
1. Go to `/loyalty/checkin`
2. Enter test phone number (e.g., `07700900001`)
3. Click "Check In"
4. See success screen with points earned and any achievements

### Step 2: View Loyalty Dashboard
1. Visit `/loyalty?phone=07700900001`
2. Explore the four sections:
   - **Home**: Overview, stats, and tier progress
   - **Achievements**: Badge collection with progress
   - **Rewards**: Available rewards based on points/tier
   - **History**: Past event attendance

### Step 3: Redeem a Reward
1. In the Rewards section, click "Redeem" on an available reward
2. Note the 5-minute countdown timer
3. The system generates:
   - A unique code (e.g., `DES1234`)
   - A QR code for scanning
4. Keep this screen open and proceed to next step

### Step 4: Process Redemption (Staff View)
1. Open `/loyalty/redeem` in a new tab
2. Either:
   - Type the code manually (e.g., `DES1234`)
   - Click "Scan QR Code" (shows demo message)
3. See validation and customer details
4. Complete the redemption

### Step 5: Test Edge Cases
- Try an expired code (wait 5 minutes)
- Try an already-used code
- Try an invalid code
- Check insufficient points message

## Technical Implementation

### No Database Changes
- All data stored in memory using mock data
- Changes persist during the session only
- Safe to test all features

### QR Code Strategy
- One QR per event (not per table)
- Customers identified by phone number
- Simplifies operations and printing

### Security Features
- 5-minute expiry on redemption codes
- One active code at a time
- Codes include reward type prefix
- QR codes include customer ID for verification

## Production Considerations

When moving to production:

1. **Database Integration**
   - Replace mock data with Supabase tables
   - Implement proper RLS policies
   - Add audit logging

2. **SMS Integration**
   - Send check-in confirmations
   - Achievement unlock notifications
   - Tier upgrade celebrations

3. **Analytics**
   - Track redemption patterns
   - Monitor tier progression
   - Measure engagement rates

4. **Staff Training**
   - QR code printing procedures
   - Redemption terminal usage
   - Customer service scripts

5. **Marketing**
   - Launch campaign materials
   - Table tent designs
   - Social media strategy

## Feedback Notes

This demo is designed to gather feedback on:
- User experience flow
- Feature completeness
- Reward structure
- Visual design
- Operational feasibility

Please test thoroughly and note any suggestions for improvements!