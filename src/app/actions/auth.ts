'use server'

import { AuthService } from '@/services/auth';

export async function signIn(email: string, password: string) {
  try {
    return await AuthService.signIn(email, password);
  } catch (error: any) {
    if (error.message.includes('Too many requests')) {
      return { error: 'Too many login attempts. Please try again later.' };
    }
    console.error('Sign in error:', error);
    return { error: error.message || 'An error occurred during sign in' };
  }
}

export async function signUp(email: string, password: string, firstName: string, lastName: string) {
  try {
    return await AuthService.signUp(email, password, firstName, lastName);
  } catch (error: any) {
    if (error.message.includes('Too many requests')) {
      return { error: 'Too many signup attempts. Please try again later.' };
    }
    console.error('Sign up error:', error);
    return { error: error.message || 'An error occurred during sign up' };
  }
}

export async function signOut() {
  try {
    return await AuthService.signOut();
  } catch (error: any) {
    console.error('Sign out error:', error);
    return { error: 'An error occurred during sign out' };
  }
}
