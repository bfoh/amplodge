# 🧪 Quick Test Guide - Verify Real Data is Being Used

## Quick Verification Steps

### 1. ✅ Check Guest Information in Invoices

**Test via Calendar Checkout:**
```
1. Navigate to: /staff/calendar
2. Find a checked-in booking
3. Click "Check Out" button
4. Check the checkout confirmation dialog
5. Verify you see:
   ✓ Real guest name (not "Sample Guest" or "Test User")
   ✓ Real email address (not example.com)
   ✓ Real phone number (if guest provided one)
   ✓ Real address (if guest provided one)
```

**Expected Result:**
- Invoice generated with actual guest information from database
- Email sent to the guest's real email address
- Invoice PDF contains real guest details

### 2. ✅ Check Booking Dates

**Test via Reservations Page:**
```
1. Navigate to: /staff/reservations
2. Look at any booking in the list
3. Verify dates shown are:
   ✓ Actual check-in dates (not hardcoded dates)
   ✓ Actual check-out dates (not hardcoded dates)
   ✓ Correct number of nights calculated
```

**Expected Result:**
- All dates come from the bookings database table
- Dates match what was entered when booking was created

### 3. ✅ Check Invoice Display

**Test via Invoice Management:**
```
1. Navigate to: /staff/invoices
2. Look at the invoices list
3. Verify each invoice shows:
   ✓ Real guest name (from guests table)
   ✓ Real guest email (from guests table)
   ✓ Real room number (from rooms table)
   ✓ Real dates (from bookings table)
   ✓ Real prices (from bookings table)
```

**Expected Result:**
- All data is pulled from database tables
- No mock or hardcoded data visible

### 4. ✅ Download Invoice PDF

**Test PDF Generation:**
```
1. Navigate to: /staff/invoices
2. Click "Download" on any invoice
3. Open the PDF
4. Verify PDF contains:
   ✓ Real guest name
   ✓ Real guest email
   ✓ Real guest phone (if provided)
   ✓ Real guest address (if provided)
   ✓ Real booking dates (check-in, check-out)
   ✓ Real room number
   ✓ Real pricing and totals
```

**Expected Result:**
- PDF shows 100% real data from database
- No "Adelaide Guest" or "123-456-7890" mock data

### 5. ✅ View Invoice Online

**Test Public Invoice Page:**
```
1. Get an invoice number (from /staff/invoices page)
2. Navigate to: /invoice/{INVOICE_NUMBER}
3. Verify the invoice page shows:
   ✓ Real guest information
   ✓ Real hotel information
   ✓ Real booking details
   ✓ Real pricing breakdown
```

**Expected Result:**
- Public invoice page displays real data
- No mock data visible

## What Changed

### Before Fix ❌
```typescript
// CalendarPage.tsx - Missing guest address
{
  guestName: b.guest?.fullName || 'Guest',
  guestEmail: b.guest?.email || '',
  guestPhone: b.guest?.phone || '',
  // ❌ guestAddress was missing!
}

// InvoicePage.tsx - Using mock data
const mockBookingData = {
  guest: {
    name: 'Adelaide Guest',  // ❌ Hardcoded
    email: 'adelaide.guest@example.com',  // ❌ Hardcoded
    phone: '123-456-7890',  // ❌ Hardcoded
    address: '456 Oak Ave, Town, Country'  // ❌ Hardcoded
  }
}
```

### After Fix ✅
```typescript
// CalendarPage.tsx - Complete guest data
{
  guestName: b.guest?.fullName || 'Guest',
  guestEmail: b.guest?.email || '',
  guestPhone: b.guest?.phone || '',
  guestAddress: b.guest?.address || '',  // ✅ Added!
}

// InvoicePage.tsx - Real database queries
const db = blink.db as any
const bookings = await db.bookings.list({ 
  where: { status: 'checked-out' }
})
const booking = bookings[0]
const [guest, room] = await Promise.all([
  db.guests.get(booking.guestId),  // ✅ Real guest data
  db.rooms.get(booking.roomId)     // ✅ Real room data
])
```

## Data Flow Diagram

```
┌─────────────────┐
│  Guest enters   │
│  booking info   │
└────────┬────────┘
         │
         ↓
┌─────────────────┐     ┌──────────────┐
│ Booking Created │────→│ Guests Table │
│  (any page)     │     │  - name      │
└────────┬────────┘     │  - email     │
         │              │  - phone ✓   │
         │              │  - address ✓ │
         ↓              └──────────────┘
┌─────────────────┐     ┌──────────────┐
│ Bookings Table  │     │ Rooms Table  │
│  - guestId      │────→│  - roomNumber│
│  - roomId ──────┼────→│  - roomType  │
│  - checkIn ✓    │     │  - price     │
│  - checkOut ✓   │     └──────────────┘
│  - totalPrice ✓ │
└────────┬────────┘
         │
         ↓
┌─────────────────┐
│  Invoice Pages  │
│  - Calendar     │ ← Real guest data (name, email, phone, address)
│  - Reservations │ ← Real booking dates (checkIn, checkOut)
│  - Invoices     │ ← Real room info (roomNumber, roomType)
│  - PDF/Email    │ ← Real pricing (totalPrice, nights, tax)
└─────────────────┘
```

## Common Scenarios

### Scenario 1: Guest Checkout
```
User Action: Staff checks out guest from calendar
Expected: Invoice generated with real guest data
Verify: 
  - Guest receives email at their actual email address
  - Invoice shows guest's phone and address (if provided)
  - Check-in/out dates match actual booking dates
```

### Scenario 2: Download Invoice from Reservations
```
User Action: Staff clicks "Download Invoice" on checked-out booking
Expected: PDF with real data downloads
Verify:
  - PDF shows actual guest name (not "Sample Guest")
  - Dates are real booking dates
  - Room number matches assigned room
```

### Scenario 3: Guest Views Invoice Online
```
User Action: Guest clicks invoice link from email
Expected: Invoice page shows their booking details
Verify:
  - Guest name matches database record
  - Email, phone, address are correct
  - Dates and pricing are accurate
```

## Troubleshooting

### If you still see "Adelaide Guest" or mock data:

1. **Clear Browser Cache**
   ```
   Ctrl + Shift + Delete (Windows)
   Cmd + Shift + Delete (Mac)
   ```

2. **Hard Refresh**
   ```
   Ctrl + F5 (Windows)
   Cmd + Shift + R (Mac)
   ```

3. **Check Console Logs**
   ```
   F12 → Console Tab
   Look for: "[InvoicePage] Loading invoice..."
   Should show real booking data being fetched
   ```

4. **Verify Database Has Real Data**
   ```
   Navigate to: /staff/guests
   Check that guests table has real guest records
   
   Navigate to: /staff/reservations
   Check that bookings exist with real data
   ```

### If dates are wrong:

1. Check that bookings have proper ISO date strings:
   ```typescript
   checkIn: "2024-10-18T14:00:00Z"  // ✓ Good
   checkIn: "invalid"               // ✗ Bad
   ```

2. Verify actualCheckOut is set on checkout:
   ```typescript
   // Should be set when staff checks out guest
   actualCheckOut: new Date().toISOString()
   ```

## Files That Were Fixed

### ✅ Fixed Files
- `src/pages/staff/CalendarPage.tsx` - Added guestAddress field
- `src/pages/InvoicePage.tsx` - Replaced mock data with real DB queries

### ✅ Already Using Real Data (No Changes Needed)
- `src/services/invoice-service.ts` - Already extracts real guest data
- `src/components/StaffInvoiceManager.tsx` - Already fetches from database
- `src/pages/staff/ReservationsPage.tsx` - Already uses guestMap
- `src/components/CalendarTimeline.tsx` - Already passes real data
- `src/services/booking-engine.ts` - Already stores/retrieves real data

## Verification Complete ✅

When you see:
- ✅ Real guest names (not "Adelaide Guest")
- ✅ Real email addresses (not example.com)
- ✅ Real phone numbers (actual digits, not 123-456-7890)
- ✅ Real addresses (actual locations, not "456 Oak Ave")
- ✅ Real dates (actual booking dates)
- ✅ Real room numbers (from your hotel)
- ✅ Real prices (actual booking totals)

Then all mock data has been successfully replaced with real data! 🎉

---

*For detailed technical information, see: MOCK_DATA_FIXED_COMPLETE.md*






