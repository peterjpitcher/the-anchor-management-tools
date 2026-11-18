import 'server-only';

import { cache } from 'react';
import type { AuthError, User } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/server';

export type CurrentUserResult = {
  user: User | null;
  error: AuthError | null;
};

/**
 * The signed-in user for this request, looked up once per server render.
 *
 * `supabase.auth.getUser()` is a network call to Supabase Auth. A page render used to make between
 * 5 and about 20 of them (the layout, every permission check, most server actions). React `cache`
 * shares one lookup across a single server render. It is not guaranteed to share anything inside a
 * server action called from the browser or a route handler, where it simply runs the lookup each
 * time, so never drop a permission check on the strength of it: the aim is fewer network calls, not
 * fewer checks.
 *
 * It goes through `createClient()`, so an /api/mcp request still resolves to its acting account.
 * The middleware keeps its own `getUser()` because it refreshes the session cookie.
 */
export const getCurrentUser = cache(async (): Promise<CurrentUserResult> => {
  const supabase = await createClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();
  return { user, error };
});
