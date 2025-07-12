# The Anchor VIPs - Enhanced Product Requirements Document
## Version 2.0 - Digital Loyalty Platform with Integrated Check-In System

### Executive Summary

The Anchor VIPs evolves from a simple SMS-based loyalty program into a comprehensive digital platform that combines attendance tracking, gamification, personalized rewards, and seamless check-in processes. The enhanced system includes a customer-facing portal, event-specific QR codes, printable table cards, and sophisticated analytics while maintaining the simplicity that makes it accessible to all customers.

---

## Core System Components

### 1. **Event-Specific QR Check-In System**

**Functionality:**
- Unique QR code generated for each booking (event + customer + timestamp)
- QR codes embedded in SMS confirmations and table cards
- Staff check-in interface with camera-based scanning
- Manual fallback search by phone number or name
- Real-time attendance tracking separate from bookings
- Automatic point allocation upon successful check-in

**Technical Implementation:**
- QR payload: Encrypted JSON with eventId, customerId, bookingId, expiry
- Web-based scanner using device camera API
- Instant validation and feedback
- Prevention of duplicate check-ins

### 2. **Customer Loyalty Portal (/loyalty)**

**Features:**
- **Authentication**: Phone number + SMS OTP (no passwords)
- **Dashboard**: Personal stats, points balance, current tier
- **Achievements**: Visual badge collection with progress indicators
- **Event History**: Complete attendance record with points earned
- **Rewards Catalog**: Available rewards based on points/tier
- **Upcoming Events**: Personalized recommendations
- **Profile Settings**: Preferences, birthday, favorite event types

**Security:**
- Completely isolated from staff systems
- Row Level Security (RLS) ensuring data privacy
- Session-based authentication with JWT tokens
- Rate limiting on all endpoints

### 3. **Event QR Code System**

**Purpose:** Simple, unified check-in system for all attendees

**How it Works:**
- **One QR code per event** - Display at entrance, bar, or on tables
- **Customers scan with phone** - Opens check-in page for that specific event
- **Phone number verification** - System identifies customer from their booking
- **Instant check-in** - Points awarded immediately

**Print Options:**
- **Large A4 poster** - For entrance or prominent display
- **Medium A5 cards** - For bar area or host station
- **Small table tents** - Multiple per table if desired

**Benefits:**
- No need to manage individual table codes
- Works for standing events or flexible seating
- Easy to update for each event
- Customers identified by their booking phone number

**Technical Requirements:**
- A4 PDF generation with print-friendly layout
- Batch printing for all bookings per event
- Professional design template
- Dynamic content based on customer data

### 4. **Enhanced Tier System**

**Tiers and Benefits:**

**🌟 VIP Member** (Entry Level - 0 events)
- Welcome bonus: 50 points
- SMS event alerts
- Birthday month recognition
- Access to loyalty portal

**🥉 VIP Bronze** (5+ events)
- All Member benefits plus:
- 100 points per attendance (vs 50 base)
- Early access booking (24 hours)
- 10% off ticketed events
- Monthly bonus challenges

**🥈 VIP Silver** (10+ events)
- All Bronze benefits plus:
- 150 points per attendance
- Bring-a-friend bonus points
- 15% off ticketed events
- Exclusive Silver-only events
- Skip-the-queue privileges

**🥇 VIP Gold** (20+ events)
- All Silver benefits plus:
- 200 points per attendance
- Complimentary welcome drink each visit
- 20% off ticketed events
- Influence on event planning
- Reserved Gold table option

**💎 VIP Platinum** (40+ events)
- All Gold benefits plus:
- 300 points per attendance
- Free plus-one to all events
- Lifetime membership status
- Custom achievement creation
- Wall of Fame recognition

### 5. **Points & Rewards System**

**Earning Points:**
- Base attendance: 50 points
- Tier multipliers: 2x (Bronze), 3x (Silver), 4x (Gold), 6x (Platinum)
- Bonus opportunities:
  - First visit of month: +50 points
  - Bring new member: +100 points
  - Complete achievement: +25-200 points
  - Birthday month: Double points
  - Weather warrior (bad weather): Triple points
  - Off-peak attendance (Mon-Wed): 1.5x points

**Reward Catalog:**
- 100 points: House snack
- 250 points: Premium snack
- 500 points: House drink
- 750 points: Premium drink
- 1000 points: Bring a friend free
- 1500 points: Reserved table
- 2000 points: £10 credit
- 5000 points: Host your own theme night

### 6. **Achievement System**

**Core Achievements:**
- 🎯 **First Timer**: Attend your first event (25 points)
- 🗓️ **Week Warrior**: Attend 4 events in one month (100 points)
- 🎭 **Event Explorer**: Try 5 different event types (150 points)
- 👥 **Social Butterfly**: Bring 5 different friends (200 points)
- 🔥 **Hot Streak**: 3 months consecutive attendance (150 points)
- 🏆 **Quiz Master**: Win a quiz night (100 points)
- 🎤 **Karaoke King/Queen**: Perform 5 times (100 points)
- 📅 **The Regular**: Attend same event type 10 times (100 points)
- 🌟 **Super Fan**: Attend 50 total events (500 points)

**Seasonal Achievements:**
- 🎃 **Halloween Hero**: Attend in costume (50 points)
- 🎄 **Festive Spirit**: Attend 3 December events (100 points)
- ☀️ **Summer Sensation**: Attend 5 summer events (100 points)
- 🎂 **Birthday Celebrant**: Attend on your birthday (100 points)

### 7. **Analytics & Reporting Dashboard**

**For Management (/loyalty-admin):**
- **Member Analytics**:
  - Total members by tier
  - Growth trends
  - Churn analysis
  - Lifetime value calculations
- **Engagement Metrics**:
  - Achievement unlock rates
  - Point redemption patterns
  - Event attendance by tier
  - No-show predictions
- **Financial Impact**:
  - Revenue per VIP vs non-VIP
  - Reward cost analysis
  - ROI calculations
  - Forecasting models

**For Staff (/check-in):**
- Today's event attendees
- Check-in progress
- VIP highlights (Gold/Platinum attending)
- Special instructions (birthdays, achievements)

### 8. **Automated Communications**

**SMS Automations:**
- **Welcome Series**: 3 messages over first month
- **Booking Confirmations**: Include QR code and tier status
- **Achievement Unlocks**: Instant celebration messages
- **Tier Upgrades**: Congratulations with new benefits
- **Birthday Wishes**: Week-of reminder with special offer
- **Win-Back Campaigns**: Re-engage after 45 days absence
- **Event Reminders**: Day-before with personalized message

**Portal Notifications:**
- New rewards available
- Points expiring warnings
- Upcoming event recommendations
- Limited-time challenges

---

## Technical Architecture

### Database Schema Extensions

```sql
-- Core Loyalty Tables
CREATE TABLE loyalty_programs (
  id UUID PRIMARY KEY,
  name VARCHAR(255),
  active BOOLEAN DEFAULT true,
  settings JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE loyalty_members (
  id UUID PRIMARY KEY,
  customer_id UUID REFERENCES customers(id),
  program_id UUID REFERENCES loyalty_programs(id),
  tier_id UUID REFERENCES loyalty_tiers(id),
  total_points INTEGER DEFAULT 0,
  available_points INTEGER DEFAULT 0,
  lifetime_points INTEGER DEFAULT 0,
  join_date DATE DEFAULT CURRENT_DATE,
  last_activity_date DATE,
  status VARCHAR(50) DEFAULT 'active'
);

CREATE TABLE loyalty_tiers (
  id UUID PRIMARY KEY,
  program_id UUID REFERENCES loyalty_programs(id),
  name VARCHAR(100),
  level INTEGER,
  min_events INTEGER,
  point_multiplier DECIMAL(3,2),
  benefits JSONB
);

CREATE TABLE event_check_ins (
  id UUID PRIMARY KEY,
  booking_id UUID REFERENCES bookings(id),
  event_id UUID REFERENCES events(id),
  customer_id UUID REFERENCES customers(id),
  check_in_time TIMESTAMPTZ,
  check_in_method VARCHAR(50), -- 'qr', 'manual'
  points_earned INTEGER,
  staff_id UUID REFERENCES users(id)
);

CREATE TABLE loyalty_achievements (
  id UUID PRIMARY KEY,
  program_id UUID REFERENCES loyalty_programs(id),
  name VARCHAR(255),
  description TEXT,
  icon VARCHAR(50),
  points_value INTEGER,
  criteria JSONB,
  active BOOLEAN DEFAULT true
);

CREATE TABLE customer_achievements (
  id UUID PRIMARY KEY,
  member_id UUID REFERENCES loyalty_members(id),
  achievement_id UUID REFERENCES loyalty_achievements(id),
  earned_date TIMESTAMPTZ DEFAULT NOW(),
  points_awarded INTEGER
);

CREATE TABLE loyalty_rewards (
  id UUID PRIMARY KEY,
  program_id UUID REFERENCES loyalty_programs(id),
  name VARCHAR(255),
  description TEXT,
  points_cost INTEGER,
  tier_required UUID REFERENCES loyalty_tiers(id),
  inventory INTEGER,
  active BOOLEAN DEFAULT true
);

CREATE TABLE reward_redemptions (
  id UUID PRIMARY KEY,
  member_id UUID REFERENCES loyalty_members(id),
  reward_id UUID REFERENCES loyalty_rewards(id),
  points_spent INTEGER,
  redeemed_at TIMESTAMPTZ DEFAULT NOW(),
  fulfilled_at TIMESTAMPTZ,
  status VARCHAR(50) DEFAULT 'pending'
);

CREATE TABLE loyalty_point_transactions (
  id UUID PRIMARY KEY,
  member_id UUID REFERENCES loyalty_members(id),
  points INTEGER, -- positive for earned, negative for spent
  transaction_type VARCHAR(50),
  description TEXT,
  reference_id UUID, -- links to check_in, achievement, redemption, etc
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- QR Code tracking
CREATE TABLE booking_qr_codes (
  id UUID PRIMARY KEY,
  booking_id UUID REFERENCES bookings(id),
  qr_code TEXT UNIQUE,
  expires_at TIMESTAMPTZ,
  used BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

### System Integration Points

1. **Booking System**: Trigger loyalty enrollment and QR generation
2. **SMS Platform**: Send automated messages and QR codes
3. **Check-In System**: Validate QR codes and award points
4. **Analytics Engine**: Track all metrics and generate insights
5. **PDF Generator**: Create professional table cards
6. **Customer Portal**: Secure self-service access

---

## User Journeys

### Customer Journey

1. **Discovery**
   - Sees table card at event
   - Receives SMS invite
   - Staff recommendation

2. **Enrollment**
   - Texts "VIP" to join
   - Auto-enrolled on first booking
   - Self-registers via portal

3. **Engagement**
   - Books events
   - Receives QR code
   - Checks in at venue
   - Earns points/achievements
   - Views progress on portal

4. **Redemption**
   - Browses reward catalog
   - Redeems points
   - Enjoys benefits
   - Shares achievements

### Staff Journey

1. **Pre-Event**
   - Print table cards
   - Review VIP attendees
   - Prepare special rewards

2. **During Event**
   - Scan QR codes
   - Handle manual check-ins
   - Apply instant rewards
   - Note special occasions

3. **Post-Event**
   - Review attendance
   - Process redemptions
   - Update customer notes

---

## Success Metrics

### Primary KPIs
- **Member Growth**: 500+ active members in Year 1
- **Engagement Rate**: 60% monthly active members
- **Revenue Impact**: 50% increase in event revenue
- **Retention**: 85% annual member retention
- **NPS Score**: 70+ from VIP members

### Secondary Metrics
- Average events per member per month
- Point redemption rate
- Achievement unlock rate
- Portal usage statistics
- Check-in time reduction

---

## Implementation Phases

### Phase 1: Foundation (Weeks 1-3)
- Database schema setup
- Basic loyalty member management
- Tier structure implementation
- Points calculation engine

### Phase 2: Check-In System (Weeks 4-5)
- QR code generation
- Staff check-in interface
- Attendance tracking
- Basic table card generation

### Phase 3: Customer Portal (Weeks 6-8)
- Authentication system
- Member dashboard
- Achievement display
- Reward catalog

### Phase 4: Gamification (Weeks 9-10)
- Achievement engine
- Automated point awards
- Progress tracking
- Celebration messages

### Phase 5: Analytics & Optimization (Weeks 11-12)
- Management dashboards
- Reporting tools
- A/B testing framework
- Performance optimization

### Phase 6: Launch & Scale (Month 4+)
- Soft launch with beta group
- Staff training program
- Marketing campaign
- Continuous iteration

---

## Risk Mitigation

### Technical Risks
- **System Complexity**: Mitigate with phased rollout
- **Performance Issues**: Implement caching and optimization
- **Security Concerns**: Regular security audits and testing

### Operational Risks
- **Staff Adoption**: Comprehensive training and incentives
- **Customer Confusion**: Clear communication and support
- **Reward Abuse**: Smart limits and fraud detection

### Business Risks
- **ROI Uncertainty**: Conservative projections and quick pivots
- **Competition**: Continuous innovation and community focus
- **Scalability**: Cloud-based architecture and modular design

---

## Investment Summary

### Development Costs
- In-house development: Included in current system
- No additional infrastructure required
- Uses existing database and hosting

### Operational Costs (Annual)
- Enhanced SMS usage: £2,000
- Reward fulfillment: £4,000
- Table card printing: £500
- Special events: £1,500
- **Total**: £8,000

### Expected Returns
- Conservative revenue increase: £60,000+
- Improved customer lifetime value
- Reduced marketing costs through retention
- **ROI**: 7.5:1

---

## Conclusion

The enhanced Anchor VIPs program transforms a simple loyalty concept into a comprehensive customer engagement platform. By combining digital innovation with tangible touchpoints like table cards, we create a premium experience that drives attendance, increases spending, and builds a passionate community around The Anchor's events.

The system leverages existing infrastructure while adding sophisticated features that position The Anchor as an industry leader in hospitality innovation. Most importantly, it maintains simplicity for customers while providing powerful tools for business growth.