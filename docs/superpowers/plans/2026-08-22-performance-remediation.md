# Performance remediation plan — staff portal

**Complaint:** the app is slow, worst on Reservations. Opening Manage Group and downloading a group invoice take too long.

**Finding:** it is not rendering and it is not the network being Ghanaian. The app downloads whole tables to do row-level work, then downloads them again after every action and every realtime event. The Reservations page moves about **1.5 MB per load**, and reloads on five separate triggers.

Everything below is measured, not assumed. Measurements were taken from European fibre directly against Supabase — the Accra figures will be several times worse, which is the point.

---

## What was measured

| Request | Payload | Time (fibre, direct) |
|---|---|---|
| `bookings?select=*` — what the app fetches | **1,098 KB** | 1,038 ms |
| the same without `special_requests` | 358 KB | 402 ms |
| `guests?select=*` | 292 KB | 307 ms |
| `booking_charges?select=*` | 71 KB | 125 ms |
| `properties?select=*` | 4 KB | 119 ms |

`special_requests` is **67% of the bookings payload**. It holds the payment metadata, guest snapshot and group data as HTML comments, and it is shipped in full to draw a list that shows a name, a room and a date.

**The proxy hop costs 0.3–1.2 s per request.** Same 4.5 KB payload: 148 ms direct, 437–1,397 ms through `supabase-proxy`. Every request pays this, so request *count* matters as much as request *size*.

### What that adds up to

| Action | Fetched | Why |
|---|---|---|
| Open Reservations | ~1.5 MB across 7 tables | `bookings.listAll` + `guests.listAll` + `bookingCharges.listAll` + rooms + tasks + roomTypes |
| Any booking changes anywhere | ~1.5 MB again | the load effect depends on 5 realtime subscriptions |
| Check in / check out / edit a charge | ~1.17 MB again | the handlers re-fetch all bookings + all charges |
| Open **Manage Group** | ~1.4 MB | `bookingEngine.getAllBookings()` + guests + properties + roomTypes — to manage 2–7 rooms |
| **Download group invoice** | N round trips + 572 KB of libraries | one charge query per booking, then jspdf (376 KB) + html2canvas (196 KB) |

The Reservations list also renders every row it holds — 1,003 bookings — with no virtualisation or paging.

---

## Phase 1 — stop shipping data nobody looks at

Biggest win by a distance. Target: **1.5 MB → under 100 KB** on load.

1. **A list view that returns display fields only.** Add a Postgres view or RPC (`reservations_list`) that returns the columns the table actually draws, with the guest name, group reference and payment summary already extracted from `special_requests` server-side. The page stops parsing HTML comments in the browser and stops downloading them.
   *Expected: 1,098 KB → ~60 KB for the same 1,003 rows.*

2. **Window the query by date.** Reservations rarely needs December 2025 on screen. Default to a range (current month ± 1, say) with an explicit "show older" control. Add an index on `check_in` to match.
   *Expected: ~1,003 rows → ~100 on a normal day.*

3. **Drop `bookingCharges.listAll()` from the page load.** The list shows a charges *total*; have the view return it, or load charges only for the row being opened.

**Risk:** the view must reproduce the parsing in `hydrateBooking` exactly. Keep the client-side path as a fallback for a release, compare the two, then delete it.
**Verify:** payload size before/after in the network panel; row counts identical; the money tests still pass.

## Phase 2 — stop reloading everything

The page reloads on any change to bookings, properties, guests, charges or housekeeping tasks — five triggers, each pulling the full 1.5 MB.

1. **Patch the row, don't refetch the table.** The realtime payload already carries the changed row. Apply it to local state.
2. **Delete the post-action refetches.** `handleCheckOut`, the charge handlers and the edit paths each re-pull every booking after doing their work; they already know what changed and the page updates optimistically.
3. **Coalesce what remains.** One debounced refresh, not five independent ones.

*Expected: a check-out goes from ~1.17 MB to one PATCH.*
**Verify:** perform each action with the network panel open; a check-out should produce a handful of small requests and no full table read.

## Phase 3 — row-level work should fetch row-level data

1. **Manage Group** currently calls `getAllBookings()` and filters in the browser. Query the group directly — `special_requests like %groupId%`, or better, promote `group_id` to a real indexed column — and fetch only that group's guests and rooms.
   *Expected: ~1.4 MB → under 10 KB.*
2. **Group invoice** issues one charge query per booking. Fetch them in a single `booking_id=in.(…)` query. At 7 rooms through the proxy that is 7 round trips replaced by 1 — several seconds saved before the PDF work even starts.

## Phase 4 — delivery and rendering

1. **Warm the PDF libraries.** 572 KB of jspdf + html2canvas load on first click. Prefetch on idle after the page settles, so the first invoice of the day isn't the slow one. They are hashed and immutable, so this is a one-time cost per deploy.
2. **Virtualise or page the list.** Render what fits on screen, not 1,003 rows.
3. **Revisit the proxy.** It exists because direct connections from Ghana were timing out. That may no longer hold, and it is costing 0.3–1.2 s on every request. Measure both paths from Accra; if direct is healthy, use it and keep the proxy as a fallback on failure rather than the default route.
4. **Indexes** for whatever Phase 1 and 3 end up filtering on: `check_in`, `status`, `group_id`.

---

## Order of work

Phase 1 and Phase 2 carry nearly all of the improvement and touch one page each. Phase 3 fixes the two specific complaints. Phase 4 is polish and infrastructure, worth doing but not first.

A note on honesty: paginated fetching (added 2026-08-22, because the server silently truncated at 1000 rows and bookings had passed it) means the bookings table now costs *two* round trips rather than one. That is correct — the alternative was missing data — but it makes Phase 1 more urgent, not less. Once the list view returns 60 KB, one page covers it again.

## How we will know it worked

Instrument before optimising, or the improvement is a matter of opinion. Add timing around the Reservations load and the two slow actions, log to Sentry, and take a baseline from an actual phone in Accra. The targets:

| | now | target |
|---|---|---|
| Reservations first paint | ~1.5 MB, 7 requests | < 100 KB, 2 requests |
| Check-out completes | ~1.17 MB refetch | 1 PATCH, no table read |
| Manage Group opens | ~1.4 MB | < 10 KB |
| Group invoice (7 rooms) | 7 charge queries + 572 KB cold | 1 query + warm libraries |
