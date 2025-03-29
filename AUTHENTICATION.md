# Authentication System Documentation

## Overview
The Event Planner application uses Supabase Auth for authentication, providing a secure and scalable authentication system with email/password login capabilities. The implementation follows Next.js 13+ best practices and uses the App Router.

## Architecture

### Key Components

1. **Middleware** (`src/middleware.ts`)
   - Protects routes under `/events`, `/bookings`, `/customers`, and `/settings`
   - Redirects unauthenticated users to `/auth/login`
   - Handles session refresh automatically
   - Redirects authenticated users away from auth pages

2. **Authentication Pages**
   - Login Page (`src/app/auth/login/page.tsx`)
   - Signup Page (`src/app/auth/signup/page.tsx`)
   - Auth Callback Handler (`src/app/auth/callback/route.ts`)

3. **Layout Components**
   - Authenticated Layout (`src/app/(authenticated)/layout.tsx`)
   - Contains sign-out functionality
   - Manages navigation sidebar

## Implementation Details

### Login Page
```typescript
// src/app/auth/login/page.tsx
- Client-side form handling with email/password
- Uses Suspense boundary for useSearchParams()
- Handles redirects after successful login
- Shows toast notifications for success/failure
```

### Sign-out Implementation
```typescript
// src/app/(authenticated)/layout.tsx
- Uses createClientComponentClient for Supabase
- Handles sign-out with proper navigation
- Integrated in the sidebar layout
```

### Protected Routes
All routes under these paths require authentication:
- `/events/*`
- `/bookings/*`
- `/customers/*`
- `/settings/*`

## Environment Variables
Required Supabase configuration:
```env
NEXT_PUBLIC_SUPABASE_URL=your_supabase_url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key
```

## Security Features
1. **Session Management**
   - Automatic session refresh
   - Secure cookie-based storage
   - Server-side session validation

2. **Route Protection**
   - Middleware-based authentication checks
   - Automatic redirects for unauthenticated users
   - Protection against direct URL access

3. **Error Handling**
   - Graceful error management
   - User-friendly error messages
   - Toast notifications for feedback

## Best Practices Implemented
1. **Client Components**
   - Proper use of 'use client' directives
   - Suspense boundaries for client hooks
   - Optimised for server components where possible

2. **Performance**
   - Minimal client-side JavaScript
   - Efficient routing with Next.js App Router
   - Proper loading states

3. **User Experience**
   - Clear feedback for user actions
   - Smooth navigation flows
   - Persistent login state

## Testing
To test the authentication system:
1. Visit the application URL
2. You should be redirected to `/auth/login`
3. Create an account or sign in
4. Verify access to protected routes
5. Test sign-out functionality
6. Verify redirect behaviour

## Common Issues and Solutions

### Build Issues
If encountering build errors with useSearchParams:
- Ensure client components are wrapped in Suspense
- Verify 'use client' directive is present
- Check component boundaries are properly set

### Session Issues
If sessions aren't persisting:
- Verify Supabase environment variables
- Check middleware configuration
- Ensure cookies are being set correctly

## Maintenance
To update the authentication system:
1. Monitor Supabase Auth package updates
2. Keep Next.js and dependencies current
3. Review security best practices regularly
4. Test authentication flows after updates 