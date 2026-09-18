import { createClient as createSupabaseClient } from '@supabase/supabase-js';
import { noStoreFetch } from '@/lib/supabase/no-store-fetch';

export interface AdminClientOptions {
  /**
   * Aborts every request this client makes once the signal fires. The weekly
   * insights report gives each section its own client with a deadline, so a
   * slow query is cancelled rather than holding the whole report open.
   */
  signal?: AbortSignal;
}

export function createAdminClient(options: AdminClientOptions = {}) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseServiceRoleKey) {
    throw new Error('Missing Supabase environment variables');
  }

  const { signal } = options;
  const fetchImpl: typeof fetch = signal
    ? (input, init) => noStoreFetch(input, {
      ...init,
      signal: init?.signal ? AbortSignal.any([init.signal, signal]) : signal,
    })
    : noStoreFetch;

  return createSupabaseClient(supabaseUrl, supabaseServiceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    },
    global: {
      fetch: fetchImpl
    }
  });
}
