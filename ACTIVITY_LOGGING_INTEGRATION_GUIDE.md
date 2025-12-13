# Activity Logging Integration Guide

## Overview
This guide explains how to integrate activity logging throughout the AMP Lodge Hotel Management System. The activity logging system automatically tracks user actions and system events for audit purposes.

## How It Works

### 1. Activity Log Storage
- Activity logs are stored in the existing `contact_messages` table
- Each log entry has `status: 'activity_log'` to distinguish from real contact messages
- Log data is stored in JSON format in the `message` field

### 2. Activity Log Structure
```typescript
{
  id: string,
  name: `[ACTION] entityType`, // e.g., "[CREATED] booking"
  email: userId, // Who performed the action
  message: JSON.stringify({
    action: string,
    entityType: string,
    entityId: string,
    details: object,
    metadata: object
  }),
  status: 'activity_log',
  createdAt: string
}
```

## Integration Examples

### 1. Authentication Logging (Already Implemented)
- **Login**: Automatically logged in `AuthPage.tsx`
- **Logout**: Automatically logged in `AppLayout.tsx`

### 2. Contact Message Logging (Already Implemented)
- **Contact Form**: Automatically logged in `ContactPage.tsx`

### 3. Booking Operations
To integrate booking logging, add these calls after booking operations:

```typescript
import { ActivityLoggerWrapper } from '@/services/activity-logger-wrapper'

// After creating a booking
await ActivityLoggerWrapper.logBookingCreated(bookingData, userId)

// After updating a booking
await ActivityLoggerWrapper.logBookingUpdated(bookingId, changes, userId)

// After cancelling a booking
await ActivityLoggerWrapper.logBookingCancelled(bookingId, reason, userId)

// After check-in
await ActivityLoggerWrapper.logCheckIn(bookingId, details, userId)

// After check-out
await ActivityLoggerWrapper.logCheckOut(bookingId, details, userId)
```

### 4. Guest Management
```typescript
// After creating a guest
await ActivityLoggerWrapper.logGuestCreated(guestData, userId)

// After updating a guest
await ActivityLoggerWrapper.logGuestUpdated(guestId, changes, userId)

// After deleting a guest
await ActivityLoggerWrapper.logGuestDeleted(guestId, guestName, userId)
```

### 5. Staff Management
```typescript
// After creating staff
await ActivityLoggerWrapper.logStaffCreated(staffData, userId)

// After updating staff
await ActivityLoggerWrapper.logStaffUpdated(staffId, changes, userId)

// After deleting staff
await ActivityLoggerWrapper.logStaffDeleted(staffId, staffName, userId)
```

### 6. Invoice Operations
```typescript
// After creating an invoice
await ActivityLoggerWrapper.logInvoiceCreated(invoiceData, userId)

// After updating an invoice
await ActivityLoggerWrapper.logInvoiceUpdated(invoiceId, changes, userId)

// After deleting an invoice
await ActivityLoggerWrapper.logInvoiceDeleted(invoiceId, invoiceNumber, userId)
```

### 7. Payment Operations
```typescript
// After receiving a payment
await ActivityLoggerWrapper.logPaymentReceived(paymentData, userId)
```

### 8. Room Management
```typescript
// After creating a room
await ActivityLoggerWrapper.logRoomCreated(roomData, userId)

// After updating a room
await ActivityLoggerWrapper.logRoomUpdated(roomId, changes, userId)

// After deleting a room
await ActivityLoggerWrapper.logRoomDeleted(roomId, roomNumber, userId)
```

### 9. Task Management
```typescript
// After completing a task
await ActivityLoggerWrapper.logTaskCompleted(taskData, userId)
```

### 10. Settings Changes
```typescript
// After changing settings
await ActivityLoggerWrapper.logSettingsChanged(settingId, changes, userId)
```

### 11. Report Exports
```typescript
// After exporting a report
await ActivityLoggerWrapper.logReportExported(reportType, filters, userId)
```

## Custom Activity Logging

For custom activities not covered by the wrapper, use the activity log service directly:

```typescript
import { activityLogService } from '@/services/activity-log-service'

await activityLogService.log({
  action: 'custom_action',
  entityType: 'custom_entity',
  entityId: 'entity_123',
  details: {
    // Custom details
  },
  userId: 'user_123',
  metadata: {
    // Custom metadata
  }
})
```

## Getting Current User ID

Use the wrapper's utility function to get the current user ID:

```typescript
import { ActivityLoggerWrapper } from '@/services/activity-logger-wrapper'

const userId = await ActivityLoggerWrapper.getCurrentUserId()
```

## Error Handling

All activity logging functions include error handling and won't fail the main operation if logging fails:

```typescript
try {
  await ActivityLoggerWrapper.logBookingCreated(bookingData, userId)
} catch (error) {
  console.error('Failed to log booking creation:', error)
  // Main operation continues even if logging fails
}
```

## Viewing Activity Logs

Activity logs can be viewed in the Activity Logs page at `/staff/activity-logs`. The page provides:

- Filtering by action, entity type, user, and date range
- Search functionality
- Export to CSV
- Real-time updates

## Testing

Use the test utilities to verify activity logging is working:

```javascript
// In browser console
await testActivityLogsFix()
await createSampleActivityLogsFix()
```

## Best Practices

1. **Always log after successful operations** - Don't log failed operations
2. **Include relevant details** - Log enough information to understand what happened
3. **Use consistent naming** - Use the same action and entity type names throughout
4. **Don't log sensitive data** - Avoid logging passwords, payment details, etc.
5. **Handle errors gracefully** - Logging failures shouldn't break main functionality

## Available Actions

- `created` - Entity was created
- `updated` - Entity was updated
- `deleted` - Entity was deleted
- `viewed` - Entity was viewed
- `checked_in` - Guest checked in
- `checked_out` - Guest checked out
- `payment_received` - Payment was received
- `payment_refunded` - Payment was refunded
- `status_changed` - Status was changed
- `assigned` - Entity was assigned
- `completed` - Task was completed
- `cancelled` - Operation was cancelled
- `exported` - Data was exported
- `imported` - Data was imported
- `login` - User logged in
- `logout` - User logged out

## Available Entity Types

- `booking` - Booking records
- `guest` - Guest information
- `invoice` - Invoice records
- `staff` - Staff accounts
- `room` - Room information
- `room_type` - Room type definitions
- `property` - Property information
- `task` - Task records
- `contact_message` - Contact form submissions
- `payment` - Payment records
- `report` - Report exports
- `settings` - System settings
- `user` - User accounts

## Integration Checklist

- [ ] Authentication logging (login/logout)
- [ ] Contact message logging
- [ ] Booking operations logging
- [ ] Guest management logging
- [ ] Staff management logging
- [ ] Invoice operations logging
- [ ] Payment operations logging
- [ ] Room management logging
- [ ] Task management logging
- [ ] Settings changes logging
- [ ] Report exports logging
- [ ] Custom operations logging

## Troubleshooting

If activity logging isn't working:

1. Check browser console for errors
2. Verify the `contact_messages` table exists
3. Ensure the activity log service is imported correctly
4. Test with the provided test utilities
5. Check that the user ID is available when logging

## Performance Considerations

- Activity logging is asynchronous and won't block main operations
- Logs are stored efficiently in JSON format
- Consider implementing log retention policies for large systems
- Use filtering and pagination when displaying large numbers of logs





