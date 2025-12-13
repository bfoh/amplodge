# 🧹 Clean Employee Database - Instructions

**Quick guide to clean all employee data except admin**

---

## ⚡ Quick Steps (1 Minute)

### Step 1: Access Cleanup Tool
```
Visit: http://localhost:3000/staff/cleanup
```

### Step 2: Login (if not already)
```
Email: admin@amplodge.com
Password: AdminAMP2025!
```

### Step 3: Scan Database
```
Click: "Scan Database" button

You'll see:
- Total staff count
- Accounts to preserve (admin)
- Accounts to delete (all others)
```

### Step 4: Review & Confirm
```
Review the lists:
✅ Green = Will be preserved (admin@amplodge.com)
❌ Red = Will be deleted (test accounts)

Click: "Confirm & Clean Database"
Confirm: Click "OK" on popup
```

### Step 5: Done!
```
✅ Cleanup complete!
✅ See deleted count
✅ Admin preserved
```

---

## 🛡️ What's Preserved

**Automatically kept safe:**
- ✅ admin@amplodge.com
- ✅ Any account with "owner" role
- ✅ Any email containing "admin"

**Everything else deleted:**
- ❌ Test accounts
- ❌ Staff accounts
- ❌ Manager accounts

---

## 📊 Visual Guide

```
Before Cleanup:
├─ admin@amplodge.com (Admin) ← SAFE ✅
├─ test@example.com (Staff) ← DELETE
├─ john.test@example.com (Staff) ← DELETE
└─ jane@example.com (Manager) ← DELETE

After Cleanup:
└─ admin@amplodge.com (Admin) ← PRESERVED ✅
```

---

## ✅ Verification

### After cleanup:

1. **Check Employees page:**
   ```
   Navigate to: /staff/employees
   Should only show: admin@amplodge.com
   ```

2. **Check Activity Log:**
   ```
   Employees page → Activity Log tab
   Should show: bulk_delete action
   ```

---

## 🚀 Access URL

```
http://localhost:3000/staff/cleanup
```

**That's it! Visit the URL and follow the on-screen prompts.** 🎯

---

## 📝 Summary

**Tool:** Web-based cleanup page  
**Access:** /staff/cleanup  
**Permission:** Admin only  
**Safety:** Admin auto-preserved  
**Time:** 1 minute  
**Logged:** Yes, in activity log  

**Go to the cleanup page now!** 🧹

---

END

