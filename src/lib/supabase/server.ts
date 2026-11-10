import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { noStoreFetch } from '@/lib/supabase/no-store-fetch';
import { getMcpActingContext } from '@/lib/mcp/acting-context';

type CookieStore = Awaited<ReturnType<typeof cookies>>;

function createCookieClient(cookieStore: CookieStore) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!supabaseUrl) throw new Error('NEXT_PUBLIC_SUPABASE_URL environment variable is not set');
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseAnonKey) throw new Error('NEXT_PUBLIC_SUPABASE_ANON_KEY environment variable is not set');

  return createServerClient(
    supabaseUrl,
    supabaseAnonKey,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet: { name: string; value: string; options: CookieOptions }[]) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            )
          } catch {
            // The `setAll` method was called from a Server Component.
            // This can be ignored if you have middleware refreshing
            // user sessions.
          }
        },
      },
      global: {
        fetch: noStoreFetch
      }
    }
  );
}

type ServerClient = ReturnType<typeof createCookieClient>;

export async function createClient(): Promise<ServerClient> {
  // Inside an /api/mcp request there are no browser cookies: the request acts as the account
  // its context names, through a real session for that account (src/lib/mcp/acting-session.ts).
  // Only /api/mcp sets the context, so every other request takes the cookie path below.
  // Both are plain supabase-js clients on the anon key with a user session; only where the
  // session comes from differs.
  const acting = getMcpActingContext();
  if (acting) {
    return (await acting.getClient()) as unknown as ServerClient;
  }

  return createCookieClient(await cookies());
}
