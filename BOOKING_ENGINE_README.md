# AMP Lodge Offline Booking Engine

## Overview
The AMP Lodge booking engine is a fully functional offline-first booking system that works seamlessly both online and offline. It uses PouchDB for local storage and automatically syncs with the remote Blink database when internet connection is available.

## Features

### ✅ Core Functionality
- **Offline-First Architecture**: All bookings are saved locally first using PouchDB
- **Automatic Sync**: Syncs with remote Blink database when online
- **Conflict Detection**: Automatically detects overlapping bookings
- **Payment Handling**: Supports Cash, Mobile Money, and Card payments
- **Reception Mode**: Special mode for front desk staff to create walk-in bookings
- **Real-time Status**: Visual indicators showing online/offline status and sync progress

### 📊 Admin Features
- **Admin Panel**: Comprehensive dashboard for managing all bookings
- **Conflict Resolution**: Interface to resolve booking conflicts
- **End-of-Day Reports**: Daily revenue and occupancy analytics
- **Audit Logs**: Complete history of all system actions
- **Manual Sync**: Force sync bookings on demand

## How to Use

### For Guests (Online Booking)
1. Visit `/booking` page
2. Follow the 4-step booking process:
   - Step 1: Select check-in and check-out dates
   - Step 2: Choose room type
   - Step 3: Enter guest details and payment method
   - Step 4: Review and confirm booking
3. If online, receive instant email confirmation
4. If offline, booking is saved locally and will sync when connection is restored

### For Reception Staff (Counter Booking)
1. Visit `/booking?admin=true`
2. Toggle to "Reception Mode" using the button in top-right
3. Follow the same booking process
4. Select appropriate payment method (cash, mobile money, or card)
5. Booking is immediately available in the system

### For Administrators

#### Access Admin Panel
- Visit `/staff/admin` to access the admin panel
- View all bookings, pending syncs, and conflicts

#### Resolve Conflicts
1. Navigate to "Conflicts" tab in admin panel
2. Review overlapping bookings
3. Click "Keep This Booking" on the booking you want to retain
4. The conflicting booking will be automatically cancelled

#### View End-of-Day Report
1. Visit `/staff/reports`
2. Select date using calendar picker
3. View summary of:
   - Total bookings
   - Total revenue
   - Payment breakdown (cash, mobile money, card)
   - Pending syncs and conflicts
4. Export report as CSV

#### Manual Sync
- Click "Sync Now" button in admin panel
- All pending bookings will sync with remote database

## Technical Architecture

### Local Storage (PouchDB)
Three local databases are created:
- `amp_lodge_bookings` - Stores all booking records
- `amp_lodge_rooms` - Stores room availability data
- `amp_lodge_audit_logs` - Stores audit trail

### Booking Data Structure
```typescript
{
  _id: "booking_<timestamp>_<random>",
  guest: {
    fullName: string,
    email: string,
    phone: string,
    address: string
  },
  roomType: string,
  roomNumber: string,
  dates: {
    checkIn: string (ISO 8601),
    checkOut: string (ISO 8601)
  },
  numGuests: number,
  amount: number,
  status: "reserved" | "confirmed" | "cancelled" | "checked-in" | "checked-out",
  source: "online" | "reception",
  synced: boolean,
  conflict?: boolean,
  payment: {
    method: "cash" | "mobile_money" | "card",
    status: "pending" | "completed" | "failed",
    amount: number,
    reference: string,
    paidAt: string
  },
  createdAt: string,
  updatedAt: string
}
```

### Sync Mechanism
1. **Online Detection**: Monitors `navigator.onLine` and window events
2. **Automatic Sync**: Triggers sync when connection is restored
3. **Conflict Detection**: Checks for overlapping bookings before saving
4. **Dual Save**: Saves to both local PouchDB and remote Blink database when online
5. **Queue Management**: Maintains queue of unsynced bookings

### Offline Banner System
- Shows real-time connection status
- Displays pending sync count
- Provides manual sync button
- Shows sync progress and completion

## Testing Offline Mode

### Test Scenario 1: Create Offline Booking
1. Open browser DevTools (F12)
2. Go to Network tab → Check "Offline" checkbox
3. Navigate to `/booking`
4. Create a new booking
5. See orange "Offline Mode" banner
6. Booking is saved locally
7. Uncheck "Offline" in DevTools
8. See automatic sync notification
9. Check `/staff/admin` to verify booking synced

### Test Scenario 2: Handle Conflicts
1. Create two bookings for same room with overlapping dates
2. Both bookings will be marked with conflict flag
3. Navigate to `/staff/admin` → Conflicts tab
4. Resolve conflict by choosing which booking to keep
5. Cancelled booking is logged in audit trail

### Test Scenario 3: Reception Booking
1. Visit `/booking?admin=true`
2. Toggle to "Reception Mode"
3. Create walk-in booking with cash payment
4. Verify booking appears in admin panel with source = "reception"

## Browser Storage
All data is stored in IndexedDB using PouchDB. You can view the data:
1. Open DevTools (F12)
2. Go to Application tab → Storage → IndexedDB
3. Expand `_pouch_amp_lodge_bookings` database
4. View document store

## Clearing Local Data
⚠️ **Warning**: This action is irreversible
1. Navigate to `/staff/admin`
2. Click "Clear All Data" button
3. Confirm action
4. All local bookings and audit logs will be deleted

## Integration Credits
Each booking confirmation email consumes integration credits from your Blink account. Offline bookings will send emails when synced.

## Troubleshooting

### Bookings Not Syncing
- Check internet connection
- Click "Sync Now" in admin panel
- Check browser console for errors
- Verify Blink database connection

### Conflicts Not Resolving
- Ensure both conflicting bookings are visible in Conflicts tab
- Check that room numbers match exactly
- Verify date overlap logic in booking engine

### Payment Status Pending
- Offline payments are marked as "pending"
- Status updates to "completed" when synced online
- Reconcile payments in End-of-Day report

## Best Practices
1. **Regular Syncs**: Sync data at the end of each shift
2. **Conflict Resolution**: Resolve conflicts immediately when detected
3. **Daily Reports**: Export end-of-day reports for accounting
4. **Audit Trail**: Review audit logs weekly for security
5. **Data Backup**: Periodically ensure all data is synced to remote

## Future Enhancements
- Real-time collaboration between multiple staff devices
- SMS notifications for offline bookings
- Advanced conflict resolution with customer prioritization
- Mobile app integration
- Integration with property management systems
