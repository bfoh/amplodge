# 🧹 How to Clean Employee Database

**Quick guide to safely remove test employee accounts**

---

## ⚡ Quick Method (Easiest)

### Option 1: Use the HTML Tool

1. **Open the cleanup tool**
   ```
   Open: clean-employees.html in your browser
   (Double-click the file or drag to browser)
   ```

2. **Click "Scan Database"**
   - Shows all employees
   - Shows which will be kept
   - Shows which will be deleted

3. **Click "Confirm & Clean Database"**
   - Deletes all test accounts
   - Preserves admin@amplodge.com
   - Preserves any owner accounts

4. **Done!** ✅

---

## 🔧 Alternative Method (Browser Console)

### Option 2: Use Browser Console

1. **Open your app**
   ```
   Visit: http://localhost:5173/staff/login
   Login as: admin@amplodge.com / AdminAMP2025!
   ```

2. **Open browser console**
   ```
   Press F12
   Go to Console tab
   ```

3. **Run this code**
   ```javascript
   // Import and run cleanup
   import('./src/services/clean-employees.ts').then(module => {
     module.cleanEmployeesDatabaseInteractive()
   })
   ```

4. **Watch the output**
   - Shows all employees
   - Shows what will be deleted
   - Shows what will be preserved
   - Executes cleanup

---

## 🛡️ Safety Features

### Automatically Preserves:
- ✅ admin@amplodge.com account
- ✅ Any account with "owner" role
- ✅ Any email containing "admin"

### Deletes:
- ❌ All other staff accounts
- ❌ Test accounts
- ❌ Employee accounts

---

## 📊 What You'll See

### Before Cleanup:
```
Total Staff: 10
├─ admin@amplodge.com (Admin) ← PRESERVED
├─ test@example.com (Staff) ← DELETED
├─ john@example.com (Staff) ← DELETED
├─ jane@example.com (Manager) ← DELETED
└─ ... etc
```

### After Cleanup:
```
Total Staff: 1
└─ admin@amplodge.com (Admin) ← PRESERVED
```

---

## 🔍 Verification

### To Verify Cleanup Worked:

1. **Go to Employees page**
   ```
   Navigate: /staff/employees
   ```

2. **Check employee list**
   ```
   Should only show: admin@amplodge.com
   ```

3. **Check activity log**
   ```
   Click "Activity Log" tab
   Should show bulk_delete action
   ```

---

## ⚠️ Important Notes

### Before Cleaning:
- Backup database if needed
- Make sure you're logged in as admin
- Verify you don't need the test accounts

### After Cleaning:
- Activity is logged
- Cannot be undone (unless you restore from backup)
- Admin account always safe

---

## 🚀 Recommended Approach

**Best Way:**
1. Use `clean-employees.html` tool
2. Click "Scan Database" first
3. Review what will be deleted
4. Click "Confirm & Clean"
5. Verify in Employees page

**Time:** ~30 seconds  
**Safety:** High (admin preserved automatically)  
**Ease:** Very easy (visual UI)

---

## 📝 Summary

**Tool:** clean-employees.html (easiest)  
**Default Password:** staff@123  
**Preserves:** Admin and owner accounts  
**Deletes:** All test/employee accounts  
**Safe:** Yes, cannot delete admin  
**Logged:** Yes, in activity log  

---

**Questions?** Just ask!  
**Ready?** Open clean-employees.html!

---

END OF GUIDE

