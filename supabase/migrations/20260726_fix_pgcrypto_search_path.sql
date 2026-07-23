-- ────────────────────────────────────────────────────────────────────────────
-- Fix: pgcrypto not on the search_path of security-definer functions.
-- ────────────────────────────────────────────────────────────────────────────
--
-- Symptom: QR panel / kiosk show "function gen_random_bytes(integer) does not
-- exist" and never fetch a code.
--
-- Cause: on Supabase, the pgcrypto extension is installed in the `extensions`
-- schema, not `public`. Our RPCs are declared `set search_path = public`, so
-- pgcrypto functions (gen_random_bytes, digest, hmac) are invisible to them.
-- The SQL-editor smoke test passed only because an interactive session's
-- search_path already includes `extensions`.
--
-- Fix: add `extensions` to the search_path of every function that calls a
-- pgcrypto function. ALTER FUNCTION ... SET changes only the config, not the
-- body — no reproduction, no redeploy. Works whether pgcrypto is in
-- `extensions` (Supabase default) or `public` (both are on the path).
--
-- Covers:
--   * mint_clock_nonce            — gen_random_bytes          (the QR failure)
--   * mint_clock_nonce_kiosk      — gen_random_bytes, digest
--   * create_clock_kiosk          — gen_random_bytes, digest
--   * rotate_proxy_secret         — gen_random_bytes
--   * _amp_log_event              — digest (runs on every clock-in/out/autoclose;
--                                   would fail the moment someone clocks in)
--
-- Apply after 20260721 + 20260723 + 20260724 + 20260725. Idempotent.
-- ────────────────────────────────────────────────────────────────────────────

alter function public.mint_clock_nonce()                            set search_path = public, extensions;
alter function public.mint_clock_nonce_kiosk(text, text)            set search_path = public, extensions;
alter function public.create_clock_kiosk(text, text)                set search_path = public, extensions;
alter function public.rotate_proxy_secret()                         set search_path = public, extensions;
alter function public._amp_log_event(text, text, text, jsonb, text) set search_path = public, extensions;

-- Verify the config took: each row's proconfig must list search_path with
-- public + extensions.
select proname, proconfig
from pg_proc
where pronamespace = 'public'::regnamespace
  and proname in (
    'mint_clock_nonce', 'mint_clock_nonce_kiosk', 'create_clock_kiosk',
    'rotate_proxy_secret', '_amp_log_event'
  )
order by proname;
