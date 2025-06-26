# Authentication System

## Overview

The Anchor Management Tools uses Supabase Auth for authentication, providing a secure and scalable authentication system with email/password login capabilities. The implementation follows Next.js 15 best practices using the App Router.

## Architecture

### Key Components

1. **Middleware** (`src/middleware.ts`)
   - Protects routes requiring authentication
   - Handles automatic session refresh
   - Redirects unauthenticated users to login
   - Prevents authenticated users from accessing auth pages

2. **Authentication Pages**
   - **Login Page** (`/auth/login`) - Email/password sign in
   - **Auth Callback** (`/auth/callback`) - Handles auth redirects
   - No public registration - users created manually in Supabase

3. **Protected Layout**
   - Authenticated layout wraps all protected pages
   - Contains navigation and sign-out functionality
   - Manages user session state

## Implementation Details

### Protected Routes
All routes under these paths require authentication:
- `/events/*` - Event management
- `/customers/*` - Customer management  
- `/employees/*` - Employee management
- `/settings/*` - Application settings
- Dashboard and other authenticated areas

### Authentication Flow
1. User visits protected route
2. Middleware checks for valid session
3. Redirects to `/auth/login` if not authenticated
4. User enters credentials
5. Supabase validates and creates session
6. User redirected to original destination
7. Session maintained via secure cookies

### Sign Out Process
1. User clicks sign out in navigation
2. Supabase client signs out user
3. Session cookies cleared
4. Redirect to login page
5. Protected routes become inaccessible

## Security Features

### Session Management
- JWT tokens with automatic refresh
- Secure HTTP-only cookies
- Session expiry after inactivity
- Cross-site request forgery protection

### Password Security
- Passwords hashed with bcrypt
- Minimum password requirements enforced
- No password stored in application
- Secure password reset flow available

### Route Protection
- Server-side session validation
- Middleware runs before page load
- No client-side route exposure
- Automatic redirect handling

## User Management

### Creating Users
Since public registration is disabled:
1. Admin logs into Supabase Dashboard
2. Navigate to Authentication → Users
3. Click "Invite User"
4. Enter email address
5. User receives invite email
6. User sets password via secure link

### Managing Users
- View all users in Supabase Dashboard
- Reset passwords via admin panel
- Disable/enable user accounts
- Monitor last sign in times
- Track user sessions

### User Roles
Currently single role implemented:
- Authenticated users have full access
- No role-based permissions yet
- All users can manage all data
- Future enhancement for role system

## Configuration

### Environment Variables
```env
NEXT_PUBLIC_SUPABASE_URL=your_supabase_url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key
```

### Supabase Settings
- Email authentication enabled
- Email confirmations required
- Secure password policy enforced
- JWT expiry: 3600 seconds
- Refresh token rotation enabled

## Best Practices

### Security Guidelines
1. Never expose service role key to client
2. Always validate sessions server-side
3. Use HTTPS in production
4. Implement rate limiting for login attempts
5. Monitor failed authentication attempts

### Development Tips
1. Test with multiple user accounts
2. Verify middleware on all routes
3. Handle edge cases (expired sessions)
4. Implement proper error messages
5. Test sign out from all pages

### User Experience
1. Clear error messages for failed login
2. Loading states during authentication
3. Persistent sessions across browser sessions
4. Remember me functionality
5. Smooth redirect flows

## Troubleshooting

### Common Issues

**User can't log in:**
- Verify email and password correct
- Check if user exists in Supabase
- Ensure user email is confirmed
- Check for account disabled status

**Session not persisting:**
- Verify cookie settings
- Check Supabase configuration
- Ensure proper domain settings
- Clear browser cookies and retry

**Redirect loops:**
- Check middleware configuration
- Verify auth callback route
- Ensure proper redirect URLs
- Check for conflicting redirects

**Build errors with auth:**
- Wrap client hooks in Suspense
- Use proper client/server separation
- Check for missing 'use client' directives
- Verify environment variables

## API Reference

### Authentication Hooks
```typescript
// Get current user
const { data: { user } } = await supabase.auth.getUser()

// Sign in
const { data, error } = await supabase.auth.signInWithPassword({
  email: 'email@example.com',
  password: 'password'
})

// Sign out
const { error } = await supabase.auth.signOut()
```

### Middleware Utilities
```typescript
// Check authentication
const { data: { session } } = await supabase.auth.getSession()

// Refresh session
const { data: { session }, error } = await supabase.auth.refreshSession()
```

## Future Enhancements

### Planned Features
1. Multi-factor authentication (MFA)
2. Social login providers
3. Role-based access control
4. Session activity monitoring
5. Password complexity requirements

### Security Improvements
1. Login attempt throttling
2. Suspicious activity detection
3. Device management
4. Security event logging
5. Compliance reporting

## Maintenance

### Regular Tasks
1. Review user access monthly
2. Check for unused accounts
3. Monitor authentication logs
4. Update Supabase Auth SDK
5. Test authentication flow

### Security Audits
1. Review middleware effectiveness
2. Check for exposed routes
3. Verify session handling
4. Test edge cases
5. Update security policies