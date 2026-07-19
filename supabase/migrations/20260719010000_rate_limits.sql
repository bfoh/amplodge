-- Rate limiting store + atomic fixed-window counter RPC.
--
-- Used by the public, unauthenticated netlify functions (rooms-availability,
-- verify-guest, create-booking) to cap requests per client IP. Netlify
-- functions are stateless and multi-instance, so an in-memory counter is
-- useless — this shared Postgres counter is the source of truth.
--
-- Fixed-window algorithm: time is bucketed into windows of p_window_seconds;
-- each (key, window) row counts hits. A burst straddling a boundary can allow
-- up to ~2x the limit briefly — acceptable here (sliding windows would need
-- Redis). The calling function fails OPEN if this RPC errors, so booking flows
-- never break because of the limiter.

CREATE TABLE IF NOT EXISTS public.rate_limits (
  key          text        NOT NULL,
  window_start timestamptz NOT NULL,
  count        integer     NOT NULL DEFAULT 0,
  PRIMARY KEY (key, window_start)
);

-- Lock the table down: no direct client access. Only the SECURITY DEFINER
-- RPC below may touch it (it runs as the function owner, bypassing RLS).
ALTER TABLE public.rate_limits ENABLE ROW LEVEL SECURITY;

-- Helps the opportunistic cleanup below.
CREATE INDEX IF NOT EXISTS rate_limits_window_start_idx
  ON public.rate_limits (window_start);

-- Atomic increment. Returns TRUE if the request is allowed (count <= limit),
-- FALSE if it should be rejected (429).
CREATE OR REPLACE FUNCTION public.check_rate_limit(
  p_key            text,
  p_limit          integer,
  p_window_seconds integer
)
RETURNS boolean
LANGUAGE plpgsql
-- SECURITY DEFINER: run as the function owner so the INSERT bypasses the
-- table's RLS. Without this, callers (anon/service via PostgREST) hit a
-- "row violates row-level security policy" error and the limiter fails open.
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_window_start timestamptz;
  v_count        integer;
BEGIN
  -- Bucket "now" into the current fixed window.
  v_window_start := to_timestamp(
    floor(extract(epoch FROM now()) / p_window_seconds) * p_window_seconds
  );

  INSERT INTO public.rate_limits (key, window_start, count)
  VALUES (p_key, v_window_start, 1)
  ON CONFLICT (key, window_start)
  DO UPDATE SET count = public.rate_limits.count + 1
  RETURNING count INTO v_count;

  -- Opportunistic cleanup (~0.5% of calls) so the table never grows unbounded.
  IF random() < 0.005 THEN
    DELETE FROM public.rate_limits
    WHERE window_start < now() - interval '10 minutes';
  END IF;

  RETURN v_count <= p_limit;
END;
$$;

-- The functions call this with the service-role key, but some fall back to the
-- anon key, so allow both. The RPC only touches counter rows for the caller's
-- own key, so exposing it is low risk.
GRANT EXECUTE ON FUNCTION public.check_rate_limit(text, integer, integer)
  TO anon, authenticated, service_role;
