# 🧪 Automated Invoicing System - Quick Test Guide

**Test the complete invoicing workflow in 5 minutes**

---

## 🎯 Quick Test Steps

### Step 1: Check Out a Guest (2 minutes)

1. **Go to Reservations Page**
   ```
   URL: http://localhost:3000/staff/reservations
   ```

2. **Find Checked-In Guest**
   - Look for guest with "checked-in" status
   - Should show "Check Out" button

3. **Click Check Out**
   - Click the "Check Out" button
   - Wait for success message
   - Should show "Invoice sent to guest@example.com"

### Step 2: Check Email (1 minute)

1. **Check Guest's Email**
   - Look for email with subject: "🏨 Your Invoice - INV-..."
   - Should contain invoice summary
   - Should have download link

### Step 3: Access Invoice (2 minutes)

1. **Click Download Link**
   - Click the download link in email
   - Should redirect to invoice page

2. **Test Invoice Page**
   - Verify invoice details displayed
   - Click "Download PDF" button
   - Click "Print Invoice" button

---

## ✅ Expected Results

### Checkout Process:
- ✅ Guest status changes to "checked-out"
- ✅ Room status changes to "cleaning"
- ✅ Housekeeping task created
- ✅ Toast shows "Invoice sent to guest@example.com"

### Email Delivery:
- ✅ Professional email received
- ✅ Invoice summary included
- ✅ Download link provided
- ✅ Mobile-responsive design

### Invoice Access:
- ✅ Invoice page loads correctly
- ✅ All booking details shown
- ✅ PDF download works
- ✅ Print functionality works

---

## 🐛 Quick Troubleshooting

### If Invoice Not Generated:
- Check browser console for errors
- Verify guest has email address
- Check if booking data is complete

### If Email Not Sent:
- Check email service configuration
- Verify Blink notifications setup
- Check console for email errors

### If Invoice Page Not Loading:
- Check invoice number in URL
- Verify booking exists in database
- Check console for errors

---

## 🎉 Success!

**If all steps work correctly, the invoicing system is fully functional!**

**Guests will now receive professional invoices automatically upon checkout.** ✅

---

END OF QUICK TEST GUIDE

