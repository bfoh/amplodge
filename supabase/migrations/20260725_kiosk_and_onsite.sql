-- ────────────────────────────────────────────────────────────────────────────
-- Attendance v3.2 — PROTOTYPE: device-scoped kiosk credentials + on-site
-- network presence. Completes NOTES #2 and #3 of 20260724.
-- ────────────────────────────────────────────────────────────────────────────
--
-- #2 KIOSK CREDENTIAL (kills the permanent-admin-session risk)
--   20260724's mint_clock_nonce is admin-only, so the entrance screen had to
--   hold a live owner/admin session — anyone who grabbed that tablet had an
--   authenticated admin browser. Here a kiosk authenticates with its own
--   hashed key (create_clock_kiosk issues it once; only the sha256 is stored),
--   and mint_clock_nonce_kiosk is callable by anon with {id, key}. The kiosk
--   never carries a user session. Revoke a lost device with revoke_clock_kiosk.
--
-- #3 ON-SITE NETWORK PRESENCE (kills GPS spoofing + relay-within-TTL)
--   All GPS is client-supplied, so geofence proves nothing on its own; and a
--   single live nonce can still be relayed to a remote colleague inside its
--   TTL. Fix: require the clock-in request to ORIGINATE from the lodge network.
--   A kiosk-minted nonce carries the kiosk's egress CIDR (allowed_cidr); the
--   nonce can then only be consumed by a request from that network. A global
--   require_onsite_network + onsite_cidrs allowlist covers admin-minted nonces
--   too. Enforcement lives in the two nonce helpers (peek + burn), so the big
--   clock_in/out bodies from 20260724 are UNCHANGED. An observed request IP is
--   also stamped onto every attendance row via a trigger, for audit.
--
--   ┌─ SECURITY-CRITICAL DEPLOYMENT REQUIREMENT ──────────────────────────────┐
--   │ The request IP is read from the X-Forwarded-For header, which a client   │
--   │ could forge by talking to Supabase directly. To prevent that, the IP is  │
--   │ TRUSTED ONLY when the request also carries x-amp-proxy-secret matching a  │
--   │ server-side secret that only the Netlify proxy knows. So:                 │
--   │   1. Run rotate_proxy_secret() and paste the returned value into the      │
--   │      Netlify env var AMP_PROXY_SECRET (the proxy injects it per request;  │
--   │      the client-supplied copy is stripped by the proxy allowlist).        │
--   │   2. Ensure Supabase is reachable ONLY through the proxy in production.   │
--   │ If the secret is unset/mismatched, _amp_request_ip() returns NULL and     │
--   │ on-site checks FAIL CLOSED (nobody clocks in) — safe, but on-site mode    │
--   │ won't work until step 1 is done. require_onsite_network defaults OFF so   │
--   │ existing deploys are unaffected until an admin opts in.                   │
--   └──────────────────────────────────────────────────────────────────────────┘
--
-- Apply after 20260721 + 20260723 + 20260724. Idempotent.
-- ────────────────────────────────────────────────────────────────────────────

-- ─── 1. Schema additions ────────────────────────────────────────────────────
alter table public.attendance_settings
  add column if not exists require_onsite_network boolean not null default false,
  add column if not exists onsite_cidrs text[] not null default '{}';

alter table public.hr_attendance
  add column if not exists clock_in_ip  inet,
  add column if not exists clock_out_ip inet;

alter table public.clock_nonces
  add column if not exists kiosk_id     text,
  add column if not exists allowed_cidr text;   -- when set, nonce consumable only from this network

-- Server-only shared secret proving a request arrived via our proxy.
alter table public.attendance_secrets
  add column if not exists proxy_secret text;   -- null until rotate_proxy_secret()

-- Registered entrance kiosks. Key is stored only as a sha256 hash.
create table if not exists public.clock_kiosks (
  id           text primary key default ('kiosk_' || substr(md5(random()::text), 1, 12)),
  label        text not null,
  key_hash     text not null,
  egress_cidr  text,                 -- optional per-kiosk network binding
  active       boolean not null default true,
  created_at   timestamptz not null default now(),
  created_by   uuid,
  last_used_at timestamptz
);
alter table public.clock_kiosks enable row level security;
revoke all on public.clock_kiosks from anon, authenticated;
-- Admins may list kiosks (the hash is not a usable credential). No client writes.
drop policy if exists clock_kiosks_admin_select on public.clock_kiosks;
create policy clock_kiosks_admin_select on public.clock_kiosks
  for select to authenticated using (public._amp_is_admin());

-- ─── 2. Request-origin helpers ──────────────────────────────────────────────

create or replace function public._amp_proxy_secret()
returns text language sql stable security definer
set search_path = public as $$
  select proxy_secret from public.attendance_secrets where id = 1
$$;

-- The client's real IP, but ONLY if the request came through our proxy (proven
-- by the shared secret). Otherwise null → callers treat as "presence unknown".
create or replace function public._amp_request_ip()
returns inet language plpgsql stable security definer
set search_path = public as $$
declare
  hdrs   json;
  secret text;
  xff    text;
  first  text;
begin
  begin
    hdrs := current_setting('request.headers', true)::json;
  exception when others then
    return null;
  end;
  if hdrs is null then return null; end if;

  secret := public._amp_proxy_secret();
  -- Fail closed: no configured secret, or header missing/mismatched => untrusted.
  if secret is null or coalesce(hdrs->>'x-amp-proxy-secret', '') <> secret then
    return null;
  end if;

  xff := coalesce(hdrs->>'x-forwarded-for', hdrs->>'x-real-ip');
  if xff is null or xff = '' then return null; end if;
  first := trim(split_part(xff, ',', 1));   -- left-most = original client
  begin
    return first::inet;
  exception when others then
    return null;
  end;
end $$;

-- Is an IP inside the global on-site allowlist?
create or replace function public._amp_ip_onsite(p_ip inet)
returns boolean language plpgsql stable security definer
set search_path = public as $$
declare
  cidrs text[];
  c     text;
begin
  if p_ip is null then return false; end if;
  select onsite_cidrs into cidrs from public.attendance_settings where id = 1;
  if cidrs is null then return false; end if;
  foreach c in array cidrs loop
    begin
      if p_ip <<= c::inet then return true; end if;
    exception when others then
      continue;  -- skip a malformed entry rather than erroring the whole check
    end;
  end loop;
  return false;
end $$;

-- ─── 3. Fold network presence into the nonce helpers ────────────────────────
-- These REPLACE the 20260724 versions, adding on-site enforcement. The
-- clock_in/out bodies call these unchanged, so no body reproduction is needed.
--
-- Rule (same in peek and burn):
--   * nonce.allowed_cidr set (kiosk-minted) -> request IP must be inside it.
--   * else require_onsite_network on        -> request IP must be on-site.
--   * else                                   -> no network constraint.

create or replace function public._amp_peek_nonce(p_token text)
returns boolean language plpgsql stable security definer
set search_path = public as $$
declare
  n           record;
  require_net boolean;
  ip          inet;
begin
  select * into n from public.clock_nonces
    where id = p_token and expires_at > now() and uses < max_uses;
  if not found then return false; end if;

  select require_onsite_network into require_net from public.attendance_settings where id = 1;

  if n.allowed_cidr is not null then
    ip := public._amp_request_ip();
    begin
      if ip is null or not (ip <<= n.allowed_cidr::inet) then return false; end if;
    exception when others then
      return false;  -- malformed stored cidr => fail closed
    end;
  elsif coalesce(require_net, false) then
    if not public._amp_ip_onsite(public._amp_request_ip()) then return false; end if;
  end if;

  return true;
end $$;

create or replace function public.validate_clock_token(p_token text)
returns boolean language plpgsql volatile security definer
set search_path = public as $$
declare
  claimed     boolean := false;
  require_net boolean;
  ip          inet;
begin
  if p_token is null or p_token = '' then return false; end if;

  select require_onsite_network into require_net from public.attendance_settings where id = 1;
  ip := public._amp_request_ip();

  -- Atomic single-use claim; the network predicate is evaluated in the same
  -- UPDATE so it can't drift between a check and the burn. `<<=` on a malformed
  -- allowed_cidr would raise, but create_clock_kiosk validates the CIDR at mint.
  update public.clock_nonces
     set uses = uses + 1, last_used_at = now(), last_used_by = auth.uid()
   where id = p_token
     and expires_at > now()
     and uses < max_uses
     and (
       case
         when allowed_cidr is not null then (ip is not null and ip <<= allowed_cidr::inet)
         when coalesce(require_net, false) then public._amp_ip_onsite(ip)
         else true
       end
     )
  returning true into claimed;

  return coalesce(claimed, false);
end $$;

-- ─── 4. Stamp the observed request IP onto attendance rows (audit) ──────────
create or replace function public._amp_stamp_ip()
returns trigger language plpgsql security definer
set search_path = public as $$
begin
  if TG_OP = 'INSERT' then
    NEW.clock_in_ip := coalesce(NEW.clock_in_ip, public._amp_request_ip());
  elsif TG_OP = 'UPDATE' then
    if NEW.clock_out_at is not null and OLD.clock_out_at is null then
      NEW.clock_out_ip := public._amp_request_ip();
    end if;
  end if;
  return NEW;
end $$;

drop trigger if exists amp_stamp_ip on public.hr_attendance;
create trigger amp_stamp_ip before insert or update on public.hr_attendance
  for each row execute function public._amp_stamp_ip();

-- ─── 5. Kiosk provisioning RPCs (#2) ────────────────────────────────────────

create or replace function public.create_clock_kiosk(p_label text, p_egress_cidr text default null)
returns jsonb language plpgsql security definer
set search_path = public as $$
declare
  k_id  text;
  k_key text;
begin
  if not public._amp_is_admin() then
    return jsonb_build_object('ok', false, 'error', 'not_admin');
  end if;
  if p_label is null or length(trim(p_label)) = 0 then
    return jsonb_build_object('ok', false, 'error', 'label_required');
  end if;
  if p_egress_cidr is not null then
    begin
      perform p_egress_cidr::inet;   -- validate now so the burn predicate can't error later
    exception when others then
      return jsonb_build_object('ok', false, 'error', 'invalid_cidr');
    end;
  end if;

  k_id  := 'kiosk_' || substr(md5(random()::text || clock_timestamp()::text), 1, 12);
  k_key := encode(gen_random_bytes(24), 'hex');
  insert into public.clock_kiosks (id, label, key_hash, egress_cidr, created_by)
    values (k_id, trim(p_label), encode(digest(k_key, 'sha256'), 'hex'), p_egress_cidr, auth.uid());

  perform public._amp_log_event(null, null, 'kiosk_created',
    jsonb_build_object('kiosk_id', k_id, 'label', trim(p_label), 'egress_cidr', p_egress_cidr),
    auth.uid()::text);

  -- Plaintext key returned ONCE; only its hash is persisted.
  return jsonb_build_object('ok', true, 'kiosk_id', k_id, 'kiosk_key', k_key);
end $$;

create or replace function public.revoke_clock_kiosk(p_kiosk_id text)
returns jsonb language plpgsql security definer
set search_path = public as $$
declare
  n int;
begin
  if not public._amp_is_admin() then
    return jsonb_build_object('ok', false, 'error', 'not_admin');
  end if;
  update public.clock_kiosks set active = false where id = p_kiosk_id;
  get diagnostics n = row_count;
  if n = 0 then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  perform public._amp_log_event(null, null, 'kiosk_revoked',
    jsonb_build_object('kiosk_id', p_kiosk_id), auth.uid()::text);
  return jsonb_build_object('ok', true);
end $$;

-- Anon-callable: kiosk authenticates with its own key, no user session.
create or replace function public.mint_clock_nonce_kiosk(p_kiosk_id text, p_kiosk_key text)
returns jsonb language plpgsql security definer
set search_path = public as $$
declare
  k    record;
  ttl  int;
  muse int;
  nid  text;
begin
  select * into k from public.clock_kiosks where id = p_kiosk_id and active = true;
  if not found
     or k.key_hash <> encode(digest(coalesce(p_kiosk_key, ''), 'sha256'), 'hex') then
    return jsonb_build_object('ok', false, 'error', 'bad_kiosk');
  end if;

  select nonce_ttl_seconds, nonce_max_uses into ttl, muse
    from public.attendance_settings where id = 1;
  ttl  := coalesce(ttl, 15);
  muse := greatest(1, coalesce(muse, 1));

  delete from public.clock_nonces where expires_at < now() - interval '2 minutes';

  nid := encode(gen_random_bytes(16), 'hex');
  insert into public.clock_nonces (id, minted_by, expires_at, max_uses, kiosk_id, allowed_cidr)
    values (nid, null, now() + make_interval(secs => ttl), muse, k.id, k.egress_cidr);

  update public.clock_kiosks set last_used_at = now() where id = k.id;
  return jsonb_build_object('ok', true, 'token', nid, 'expires_in', ttl);
end $$;

-- ─── 6. On-site network + proxy-secret admin RPCs (#3) ──────────────────────

create or replace function public.set_onsite_network(p_enabled boolean, p_cidrs text[])
returns jsonb language plpgsql security definer
set search_path = public as $$
declare
  c text;
begin
  if not public._amp_is_admin() then
    return jsonb_build_object('ok', false, 'error', 'not_admin');
  end if;
  if p_cidrs is not null then
    foreach c in array p_cidrs loop
      begin
        perform c::inet;
      exception when others then
        return jsonb_build_object('ok', false, 'error', 'invalid_cidr', 'value', c);
      end;
    end loop;
  end if;
  update public.attendance_settings
     set require_onsite_network = coalesce(p_enabled, false),
         onsite_cidrs           = coalesce(p_cidrs, '{}'),
         updated_at             = now()
   where id = 1;
  perform public._amp_log_event(null, null, 'onsite_network_set',
    jsonb_build_object('enabled', coalesce(p_enabled, false), 'cidrs', coalesce(p_cidrs, '{}')),
    auth.uid()::text);
  return jsonb_build_object('ok', true);
end $$;

-- Rotate the proxy shared secret. Returns it ONCE — paste into Netlify env
-- AMP_PROXY_SECRET. Until env + DB match, _amp_request_ip() returns null.
create or replace function public.rotate_proxy_secret()
returns jsonb language plpgsql security definer
set search_path = public as $$
declare
  s text;
begin
  if not public._amp_is_admin() then
    return jsonb_build_object('ok', false, 'error', 'not_admin');
  end if;
  s := encode(gen_random_bytes(24), 'hex');
  update public.attendance_secrets set proxy_secret = s where id = 1;
  perform public._amp_log_event(null, null, 'proxy_secret_rotated', '{}'::jsonb, auth.uid()::text);
  return jsonb_build_object('ok', true, 'proxy_secret', s);
end $$;

-- ─── 7. Grants ──────────────────────────────────────────────────────────────
-- Internal helpers: no client execute.
revoke execute on function public._amp_proxy_secret()     from public, anon, authenticated;
revoke execute on function public._amp_request_ip()       from public, anon, authenticated;
revoke execute on function public._amp_ip_onsite(inet)    from public, anon, authenticated;
revoke execute on function public._amp_stamp_ip()         from public, anon, authenticated;
revoke execute on function public.validate_clock_token(text) from public, anon, authenticated;
revoke execute on function public._amp_peek_nonce(text)      from public, anon, authenticated;

-- Kiosk mint is anon (device key is the credential, not a user session).
grant execute on function public.mint_clock_nonce_kiosk(text, text) to anon, authenticated;
-- Admin-guarded RPCs (each re-checks _amp_is_admin internally).
grant execute on function public.create_clock_kiosk(text, text)     to authenticated;
grant execute on function public.revoke_clock_kiosk(text)           to authenticated;
grant execute on function public.set_onsite_network(boolean, text[]) to authenticated;
grant execute on function public.rotate_proxy_secret()              to authenticated;

-- ─── NOTES / remaining hardening (beyond this prototype) ────────────────────
-- * On-site mode assumes staff clock in on the lodge's own network (Wi-Fi with
--   a known static egress). Staff on mobile data won't share that IP — that's
--   the intended constraint (proves physical presence), but communicate it.
-- * A BLE-beacon token would tighten presence further (proves in-building, not
--   just on-network) and would slot in as a second allowed_cidr-style predicate.
-- * kiosk key rotation UI + per-kiosk rate limiting on mint_clock_nonce_kiosk
--   are left as ops follow-ups; the mint is cheap and the nonce is single-use.
