# 🧾 Invoice System - Quick Reference Guide

## For Staff: How to Use the Invoice System

### 🔄 Automatic Invoice Generation

**Invoices are automatically created when you check out a guest!**

1. Go to **Calendar** page (`/staff/calendar`)
2. Find the guest booking (must be "checked-in" status)
3. Click **"Check Out"** button
4. Confirm checkout
5. ✅ Done! Invoice automatically:
   - Generated and saved
   - Emailed to guest with PDF attachment
   - Available in the Invoices management page

### 📊 Managing Invoices

**Access the Invoices page:** `/staff/invoices` (in sidebar under "Admin" section)

#### View All Invoices
- See complete list of all generated invoices
- Shows: Invoice #, Guest name, Room, Dates, Amount, Status

#### Search for an Invoice
- Use the search bar at the top
- Search by:
  - Invoice number (e.g., "INV-12345")
  - Guest name
  - Guest email
  - Room number

#### Download Invoice PDF
1. Find the invoice in the list
2. Click **"Download"** button
3. PDF saves to your computer
4. Give to guest at counter or save for records

#### Print Invoice at Counter
1. Find the invoice in the list
2. Click **"Print"** button
3. Print dialog opens automatically
4. Print and hand to guest

#### Resend Invoice Email
1. Find the invoice in the list
2. Click **"Resend"** button
3. Email sent again to guest
4. Useful if guest lost original email

#### View Invoice Online
1. Find the invoice in the list
2. Click **"View"** button
3. Opens in new tab
4. Can share link with guest

### 📋 Counter Operations (Alternative Method)

**From the Reservations page:**

1. Go to **Reservations** page (`/staff/reservations`)
2. Find a checked-out booking
3. Click **"Download Invoice"** button
4. Invoice downloads as PDF
5. Print and give to guest

### 📧 What the Guest Receives

When you check out a guest, they automatically receive:

**Email with:**
- Professional invoice summary
- PDF attachment (ready to save/print)
- Link to view invoice online
- Hotel contact information

**Guest Can:**
- Download PDF from email attachment
- Visit online link to view invoice
- Print directly from the invoice page
- Save for their records

---

## Guest Invoice Link Format

Guests access their invoice at:
```
https://yourdomain.com/invoice/{INVOICE_NUMBER}
```

Example:
```
https://yourdomain.com/invoice/INV-1729267890-ABC123
```

---

## Quick Tips

✅ **DO:**
- Check invoices page regularly for accounting
- Use search to find specific invoices quickly
- Download invoices before end of month for records
- Resend emails if guest didn't receive original

❌ **DON'T:**
- Manually create invoices (system does it automatically)
- Delete bookings before checkout (invoice won't generate)
- Forget to verify guest email is correct before checkout

---

## Troubleshooting

### Guest didn't receive invoice email?
1. Go to Invoices page
2. Search for their invoice
3. Click "Resend" button
4. Or click "View" and share the link directly

### Need to print invoice at counter?
**Option 1:** Use Invoices page
- Search for invoice → Click "Print"

**Option 2:** Use Reservations page
- Find booking → Click "Download Invoice" → Print PDF

### Can't find an invoice?
- Check that guest was properly checked out
- Search by guest name or room number
- Verify checkout actually completed successfully

### Invoice shows wrong information?
- Ensure booking details were correct before checkout
- Future: Invoice editing feature (coming soon)

---

## Invoice Details

### What's Included in Each Invoice:
- Unique invoice number
- Issue date and due date
- Guest information (name, email, phone, address)
- Booking details (room, check-in/out dates, nights)
- Charge breakdown (room rate × nights)
- Tax calculation (10%)
- Total amount
- Hotel contact information

### Invoice Status Types:
- **Issued**: Invoice created and sent to guest
- **Paid**: Payment received (future feature)
- **Overdue**: Past due date (future feature)
- **Cancelled**: Booking cancelled

---

## Access Permissions

**Who can access invoices?**
- ✅ Admin
- ✅ Owner
- ❌ Manager (can see in reservations only)
- ❌ Staff (can see in reservations only)

**Guest access:**
- Guests can view their own invoice using the link from email
- No login required (invoice number is the key)

---

## Support

For issues with the invoice system:
1. Check this guide first
2. Verify booking details are correct
3. Ensure guest email is valid
4. Check console logs for technical errors
5. Contact system administrator if problem persists

---

*Quick Reference Guide v1.0*
*Last Updated: October 18, 2025*

