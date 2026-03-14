import { createClient } from '@/lib/supabase/server';
import { checkRateLimit } from '@/lib/rate-limit-server';
import { AuditService } from './audit';
import { headers } from 'next/headers';

export class AuthService {
  static async signIn(email: string, password: string) {
    // Rate limit auth attempts by IP
    await checkRateLimit('api', 5); // 5 attempts per minute
    
    const supabase = await createClient();
    
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      console.error('Supabase Auth Error:', error.message); // Log actual error for debugging

      // Check for system/connection errors (e.g. Supabase returning 500 HTML instead of JSON)
      const isSystemError = error.message.includes('Unexpected token') || 
                           error.message.includes('fetch failed') ||
                           error.message.includes('Load failed');

      // Log failed login attempt
      try {
        const headersList = await headers();
        const userAgent = headersList.get('user-agent') || 'Unknown';
        const ip = headersList.get('x-forwarded-for')?.split(',')[0] || 
                   headersList.get('x-real-ip') || 
                   '127.0.0.1';

        await AuditService.logAuditEvent({
          user_email: email,
          operation_type: 'login_failed',
          resource_type: 'auth',
          operation_status: 'failure',
          additional_info: {
            error: error.message,
            ip_address: ip,
            user_agent: userAgent,
            is_system_error: isSystemError
          }
        });
      } catch (auditError) {
        console.error('Failed to log audit event:', auditError);
        // Don't block the user response if audit logging fails
      }

      if (isSystemError) {
        throw new Error('Authentication service unavailable. Please contact support.');
      }

      throw new Error('Invalid email or password');
    }

    if (data.user) {
      // Log successful login
      await AuditService.logAuditEvent({
        user_id: data.user.id,
        user_email: data.user.email || undefined,
        operation_type: 'login',
        resource_type: 'auth',
        operation_status: 'success',
        additional_info: { method: 'password' }
      });
    }

    return { success: true, userId: data.user.id };
  }

  // Self-registration is disabled. This application is invite-only.
  // Users must be invited by an administrator via the invite flow.
  static async signUp(
    _email: string,
    _password: string,
    _firstName: string,
    _lastName: string
  ) {
    throw new Error('Registration is not available. Please contact an administrator.');
  }

  static async signOut() {
    const supabase = await createClient();
    
    // Get current user before signing out
    const { data: { user } } = await supabase.auth.getUser();
    
    if (user) {
      // Log signout
      await AuditService.logAuditEvent({
        user_id: user.id,
        user_email: user.email || undefined,
        operation_type: 'logout',
        resource_type: 'auth',
        operation_status: 'success'
      });
    }
    
    const { error } = await supabase.auth.signOut();
    
    if (error) {
      throw new Error(error.message);
    }

    return { success: true };
  }
}
