# Staff Attendance via QR Code — Implementation Plan

**Project:** AMP Lodge Hotel Management System
**Feature:** Staff clock-in/out using QR code
**Date:** March 2026

---

## How It Works (Overview)

A QR code is printed and posted at the hotel entrance. Staff scan it with their phone, land on a mobile-optimized clock-in/out page, tap one button, and they're done. The admin dashboard updates in real time.

---

## 1. The QR Code

**What it contains:** A time-rotating URL — `https://amplodge.org/staff/clock?t=TOKEN`

- The token encodes the current 10-minute time window (like TOTP)
- QR code regenerates every 10 minutes on the admin dashboard
- Old tokens are rejected — prevents staff from using a saved screenshot
- Admin prints the current QR, or displays it on a monitor/tablet at the entrance

**Where it goes:** One printed/displayed QR code at the hotel entrance (and optionally one at exit).

**No special hardware needed** — phone camera is enough. iOS and Android both open URLs directly from the camera app.

---

## 2. Staff Experience (Mobile Flow)

### First time
1. Scan QR → phone opens `amplodge.org/staff/clock?t=TOKEN`
2. Not logged in → brief login screen → redirected back to clock page
3. Browser saves session — they won't need to log in again

### Every day after
1. Scan QR → phone opens clock page instantly (session persists)
2. Token validated (must be current or previous 10-min window)
3. One-tap: **Clock In** or **Clock Out**
4. Confirmation shown — done in under 5 seconds

### Clock Page UI (mobile-first, full screen)

**Not yet clocked in:**
```
┌──────────────────────────┐
│  🏨 AMP Lodge            │
│                          │
│  Good morning, Kofi!     │
│  Wed, 26 Mar 2026        │
│  08:34 AM                │
│                          │
│  ╔════════════════════╗  │
│  ║   ✅  CLOCK IN     ║  │
│  ╚════════════════════╝  │
│                          │
└──────────────────────────┘
```

**Already clocked in:**
```
┌──────────────────────────┐
│  Clocked in at 08:34 AM  │
│  Duration: 4h 12m        │
│                          │
│  ╔════════════════════╗  │
│  ║   🚪  CLOCK OUT    ║  │
│  ╚════════════════════╝  │
└──────────────────────────┘
```

**Logic:**
- No clock-in today → show **Clock In** button only
- Clocked in but not out → show **Clock Out** button only
- Both done → "Shift complete — see you tomorrow!"
- Expired/invalid token → "QR code expired. Please scan the updated code."

---

## 3. Admin Dashboard (Attendance Tab)

### Live Now Panel (top of page, auto-refreshes every 30 seconds)
```
Live Now — 3 staff present                    ↺ Refreshing
┌────────────────────────────────────────────────────┐
│ 🟢  Kofi Mensah      Clocked in:  08:30 AM         │
│ 🟢  Ama Boateng     Clocked in:  09:15 AM         │
│ 🟢  Kwame Adu       Clocked in:  07:45 AM         │
└────────────────────────────────────────────────────┘

Absent Today: Yaw Darko, Abena Asante
```

### Stats Row (existing)
- Present Today: **3**
- Hours This Week: **14.5**
- Absent Today: **2**

### QR Code Panel (admin only — for printing/display)
- Shows current rotating QR code
- Countdown to next refresh (e.g. "Refreshes in 3:42")
- "Print QR Code" button → opens print dialog

### Attendance Records Table (existing)
- Full log of clock-in/out times for the day
- Admin can manually add or edit a record

### Admin Actions
- **Manual entry** — log attendance for staff who forgot to scan
- **Edit record** — correct a wrong clock time
- **Export** — download weekly/monthly attendance as CSV

---

## 4. Data Model (`hr_attendance` table)

Each scan creates or updates one row per staff per day:

| Column | Type | Notes |
|--------|------|-------|
| `id` | TEXT PK | unique record ID |
| `staff_id` | TEXT | auth user ID |
| `staff_name` | TEXT | display name |
| `date` | TEXT | YYYY-MM-DD |
| `clock_in` | TEXT | HH:MM:SS |
| `clock_out` | TEXT | HH:MM:SS (empty until clock-out) |
| `hours_worked` | NUMERIC | calculated on clock-out |
| `status` | TEXT | "present" / "absent" / "half-day" |
| `notes` | TEXT | admin notes |
| `created_at` | TEXT | ISO timestamp |

---

## 5. Security & Anti-Gaming

| Concern | Solution |
|---------|----------|
| Clocking in from home | Rotating token required (must be at entrance to scan) |
| Sharing QR screenshot | Token expires every 10 minutes — screenshot becomes invalid |
| Clocking in for a colleague | Each login is tied to a specific account |
| Forgetting to clock out | Admin can manually edit; auto-close at midnight |
| GPS spoofing | Token expiry is the primary control; GPS is secondary |

### Phase 2: GPS Location Check
- `navigator.geolocation.getCurrentPosition()` called on clock action
- Checks if within 200m of hotel coordinates
- Shows warning if outside range (soft block — admin can override)
- Hotel coordinates configurable in app settings

---

## 6. Rotating QR Token Algorithm

```
window = Math.floor(Date.now() / (10 * 60 * 1000))  // changes every 10 min
token  = btoa(window.toString())                      // base64 encode

Valid tokens: current window AND previous window (20 min grace for slow scanners)
```

QR URL: `https://amplodge.org/staff/clock?t=TOKEN`

---

## 7. Files Created / Modified

| File | Action | Purpose |
|------|--------|---------|
| `docs/attendance-plan.md` | **Created** | This document |
| `src/services/attendance-service.ts` | **Created** | Clock in/out, token validation, GPS check |
| `src/pages/staff/ClockPage.tsx` | **Created** | Mobile clock-in/out page |
| `src/components/attendance/QRCodeDisplay.tsx` | **Created** | Admin QR panel with countdown + print |
| `src/pages/staff/HRPage.tsx` | **Modified** | Live Now panel + real-time polling in Attendance tab |
| `src/App.tsx` | **Modified** | Add `/staff/clock` route |
| `src/lib/rbac.ts` | **Modified** | Allow all roles on `/staff/clock` |
| `src/components/layout/AppLayout.tsx` | **Modified** | Full-screen layout for clock page (no sidebar) |

---

## 8. Phase Rollout

### Phase 1 — Core (implemented)
- [x] Mobile clock-in/out page with QR token validation
- [x] Rotating QR code display in admin dashboard
- [x] Live Now panel with 30-second auto-refresh
- [x] Manual attendance entry/edit for admin

### Phase 2 — Enhanced Security (implemented)
- [x] 10-minute rotating QR tokens (anti-screenshot)
- [x] GPS location verification (soft block with admin override)
- [x] Auto clock-out at midnight for missed clock-outs
- [x] CSV export of attendance records
