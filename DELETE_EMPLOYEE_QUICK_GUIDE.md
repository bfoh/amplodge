# 🗑️ Delete Employee - Quick Guide

**Complete data removal in 3 clicks!**

---

## ⚡ Quick Steps

### Delete Single Employee:

```
1. Go to: Employees page
2. Find employee → Click (⋮) → Delete
3. Confirm → Click "Delete Everything"
Done! ✅
```

### Clean All Test Employees:

```
1. Go to: http://localhost:3000/staff/cleanup
2. Click: "Scan Database"
3. Click: "Confirm & Cascade Delete All"
Done! ✅
```

---

## 🗑️ What Gets Deleted

```
Employee Delete
    ↓
Removes:
├─ ✅ Staff record
├─ ✅ User login account
├─ ✅ Activity logs
└─ ✅ Booking references (anonymized)

Preserves:
├─ Guests (independent)
├─ Properties (independent)
└─ Booking data (business records)
```

---

## ⚠️ Important

**This deletes:**
- Staff record
- Login account
- All employee data

**Cannot be undone!**

**Admin account always safe!** ✅

---

## 🎯 URLs

```
Employees Page:
http://localhost:3000/staff/employees

Cleanup Tool:
http://localhost:3000/staff/cleanup
```

---

**Quick Ref v1.0**  
**Use:** Anytime you need to remove employees completely

---

END

