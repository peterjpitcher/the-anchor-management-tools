-- Fix create_short_link RPC ambiguity caused by function overloading.
-- PostgREST cannot resolve between TEXT vs VARCHAR overloads, so link creation fails with PGRST203.
-- We keep the original TABLE-returning function and drop the later JSONB-returning overload.

drop function if exists public.create_short_link(
  p_destination_url text,
  p_link_type text,
  p_metadata jsonb,
  p_expires_at timestamptz,
  p_custom_code text
);

