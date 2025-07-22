-- Create tables for loyalty portal OTP authentication

-- OTP verification table
CREATE TABLE IF NOT EXISTS loyalty_otp_verifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone_number VARCHAR(20) NOT NULL,
  customer_id UUID REFERENCES customers(id) ON DELETE CASCADE,
  member_id UUID REFERENCES loyalty_members(id) ON DELETE CASCADE,
  otp_code VARCHAR(6) NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  attempts INTEGER DEFAULT 0,
  verified BOOLEAN DEFAULT false,
  verified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Portal sessions table
CREATE TABLE IF NOT EXISTS loyalty_portal_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id UUID REFERENCES loyalty_members(id) ON DELETE CASCADE NOT NULL,
  customer_id UUID REFERENCES customers(id) ON DELETE CASCADE NOT NULL,
  session_token VARCHAR(64) UNIQUE NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  active BOOLEAN DEFAULT true,
  last_activity_at TIMESTAMPTZ DEFAULT NOW(),
  ended_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_loyalty_otp_phone ON loyalty_otp_verifications(phone_number);
CREATE INDEX IF NOT EXISTS idx_loyalty_otp_expires ON loyalty_otp_verifications(expires_at) WHERE verified = false;
CREATE INDEX IF NOT EXISTS idx_loyalty_sessions_token ON loyalty_portal_sessions(session_token) WHERE active = true;
CREATE INDEX IF NOT EXISTS idx_loyalty_sessions_expires ON loyalty_portal_sessions(expires_at) WHERE active = true;

-- Enable RLS
ALTER TABLE loyalty_otp_verifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE loyalty_portal_sessions ENABLE ROW LEVEL SECURITY;

-- RLS policies for OTP verifications (no direct access, only through server actions)
CREATE POLICY "No direct access to OTP verifications" ON loyalty_otp_verifications
  FOR ALL USING (false);

-- RLS policies for portal sessions (no direct access, only through server actions)
CREATE POLICY "No direct access to portal sessions" ON loyalty_portal_sessions
  FOR ALL USING (false);