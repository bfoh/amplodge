# Employee Creation Workflow - User Guide

**Version:** 1.0  
**Date:** October 2025  
**Feature:** Automated Employee Onboarding with Default Credentials

---

## 🎯 Overview

This guide explains the new streamlined employee creation process with automatic credential generation and email delivery.

---

## 👨‍💼 For Administrators

### Creating a New Employee

**Step 1: Navigate to Employees Page**
```
1. Login to Staff Portal
2. Click "Employees" in the Admin section (sidebar)
```

**Step 2: Fill in Employee Information**
```
1. Click "Add Employee" button
2. Enter required information:
   - Full Name (e.g., "John Smith")
   - Email Address (e.g., "john.smith@example.com")
   - Role (Staff/Manager/Admin/Owner)
3. Click "Create Employee"
```

**Step 3: System Automatically:**
```
✅ Creates user account
✅ Sets default password: staff@123
✅ Flags account for mandatory password change
✅ Creates staff record
✅ Sends welcome email to employee
✅ Shows success confirmation
```

**Step 4: Confirmation Dialog**
```
You'll see a success dialog showing:
- Employee name and email
- Confirmation that email was sent
- Default login credentials
- Copy button for password
- Resend email option (if needed)
```

### What the Employee Receives

**Email Content:**
- Welcome message with their role
- Login credentials clearly displayed
- Default password: `staff@123`
- Security notice about password change requirement
- Direct link to staff portal
- Step-by-step instructions

### Managing Email Failures

**If Email Send Fails:**
```
1. Employee is still created successfully
2. Warning message appears
3. Credentials shown in dialog
4. Use "Resend Email" button
5. Or manually share credentials
```

---

## 👤 For New Employees

### First-Time Login Process

**Step 1: Check Your Email**
```
Subject: Welcome to AMP Lodge Staff Portal

Look for an email with:
- Your email/username
- Default password: staff@123
- Link to staff portal
```

**Step 2: Access Staff Portal**
```
Option A: Click "Access Staff Portal" button in email
Option B: Visit: [your-domain]/staff/login
```

**Step 3: Enter Credentials**
```
Email/Username: [your.email@example.com]
Password: staff@123
```

**Step 4: Required Password Change**
```
⚠️ IMPORTANT: Password change is mandatory!

1. Dialog will automatically appear
2. Cannot close without changing password
3. Requirements:
   - Minimum 8 characters
   - Mix of letters, numbers recommended
   - Must match confirmation field
4. Click "Change Password"
```

**Step 5: Access Dashboard**
```
✅ Password changed successfully!
✅ Redirected to your dashboard
✅ Ready to start work
```

### Subsequent Logins

**After First Login:**
```
1. Visit: [your-domain]/staff/login
2. Enter your email
3. Enter YOUR NEW PASSWORD (not staff@123)
4. Click "Sign In"
5. Access dashboard directly
```

---

## 🔒 Security Features

### Password Requirements

**Default Password:**
- Shared default: `staff@123`
- Easy to communicate and remember
- Only valid for first login

**New Password Requirements:**
- Minimum 8 characters
- Must be different from default
- Recommended: mix of letters, numbers, symbols

### Security Measures

1. **Forced Password Change**
   - Cannot bypass on first login
   - Dialog cannot be closed
   - Must change to access system

2. **First Login Flag**
   - System tracks first login status
   - Automatically cleared after password change
   - Prevents skipping password change

3. **Email Security**
   - Credentials sent via secure email
   - Limited time window before required change
   - Clear security instructions

---

## 📧 Email Template

### What Employees See

**Subject:** Welcome to AMP Lodge Staff Portal

**Content Includes:**
- Professional welcome message
- AMP Lodge branding
- Clear credentials box with:
  - Email/Username
  - Default Password (prominently displayed)
- Security notice (highlighted)
- Direct login link (big button)
- Step-by-step instructions
- Contact information

**Sample:**
```
Hi John Smith,

You have been added to the AMP Lodge Hotel Management System as a Manager.

Your Login Credentials:
┌─────────────────────────────┐
│ Email/Username              │
│ john.smith@example.com      │
│                             │
│ Default Password            │
│ staff@123                   │
└─────────────────────────────┘

🔒 Security Notice:
This is a default password shared by all new employees.
You MUST create a new secure password immediately after logging in.

[Access Staff Portal Button]

Getting Started:
1. Click button above
2. Enter your credentials
3. Create new secure password
4. Access your dashboard
```

---

## 🛠️ Troubleshooting

### Problem: Didn't Receive Email

**Solutions:**
1. Check spam/junk folder
2. Verify email address with admin
3. Admin can resend from dialog
4. Admin can manually share credentials

**Admin Action:**
```
1. Navigate to Employees page
2. Recent creation dialog should still be visible
3. Click "Resend Email" button
4. Or copy credentials and send manually
```

### Problem: Can't Login

**Possible Causes:**
1. Using wrong email
2. Typo in password (case-sensitive)
3. Account not created yet
4. System issue

**Solutions:**
1. Double-check email from welcome message
2. Copy-paste password (it's `staff@123`)
3. Contact administrator
4. Admin can verify account exists

### Problem: Password Change Dialog Won't Show

**Cause:** First login flag not set

**Admin Fix:**
```typescript
// Contact development team
// Flag needs to be set manually
```

### Problem: Forgot New Password

**Solution:**
1. Use password reset feature (if available)
2. Or contact admin for account reset
3. Admin may need to recreate account

---

## 📊 Admin Dashboard

### Viewing Employee Status

**Check Created Employees:**
```
1. Navigate to Employees page
2. View employee list
3. Check created date
4. View role assignments
```

### Managing Employee Roles

**Change Roles:**
```
1. Click menu (⋮) next to employee
2. Select "Edit"
3. Change role
4. Click "Update Employee"
```

**Role Options:**
- **Staff** - Basic operations
- **Manager** - Supervisory access
- **Admin** - Full operations + employee management
- **Owner** - Complete system access

### Activity Logging

**Track Actions:**
```
1. Navigate to Employees page
2. Click "Activity Log" tab
3. View all employee-related actions:
   - Creation
   - Updates
   - Deletions
   - Role changes
```

---

## ⚡ Quick Reference

### Default Credentials

| Field | Value |
|-------|-------|
| **Username** | Employee's email address |
| **Default Password** | `staff@123` |
| **Must Change** | ✅ Yes, on first login |

### Admin Actions

| Action | Location | Button |
|--------|----------|--------|
| Create Employee | Employees Page | "Add Employee" |
| Resend Email | Success Dialog | "Resend Email" |
| Edit Employee | Employee Row Menu | "Edit" |
| View Activity | Employees Page | "Activity Log" Tab |

### Employee Actions

| Step | Action |
|------|--------|
| 1 | Check email for credentials |
| 2 | Visit staff portal login |
| 3 | Enter email + staff@123 |
| 4 | Change password (required) |
| 5 | Access dashboard |

---

## 📱 Support Contacts

### For Employees

**Need Help?**
- Email: support@amplodge.com
- Contact your direct supervisor
- Contact system administrator

### For Administrators

**Technical Issues:**
- Email: tech@amplodge.com
- Check troubleshooting section above
- Review activity logs for details

---

## ✅ Checklist

### For Admins Creating Employee

- [ ] Verify email address is correct
- [ ] Select appropriate role
- [ ] Confirm success dialog appears
- [ ] Verify email sent (green banner)
- [ ] Inform employee to check their email
- [ ] Available to help if issues arise

### For New Employees First Login

- [ ] Email received and read
- [ ] Credentials noted
- [ ] Staff portal accessed
- [ ] Login successful
- [ ] New password created
- [ ] Password meets requirements
- [ ] Password confirmed
- [ ] Dashboard accessible

---

## 🎓 Training Resources

### For Administrators

**Recommended Reading:**
1. RBAC_WORKFLOW.md - Role permissions
2. STABILITY_TESTING_GUIDE.md - Testing procedures
3. EMPLOYEE_CREATION_WORKFLOW_PLAN.md - Technical details

**Training Topics:**
- Employee management best practices
- Role assignment guidelines
- Security policy overview
- Troubleshooting common issues

### For Employees

**Recommended Reading:**
1. User manual (when available)
2. Role-specific guides
3. System overview documentation

**Training Topics:**
- System navigation
- Daily operations
- Your role responsibilities
- Security best practices

---

## 📝 FAQs

### Q: Why is the default password the same for everyone?

**A:** For simplicity and ease of communication. Security is ensured because:
- Password must be changed immediately on first login
- Change is mandatory (cannot be bypassed)
- Old password becomes invalid after change
- Each employee gets unique new password

### Q: What if employee loses welcome email?

**A:** Admin can resend the email from the success dialog, or manually share the credentials. Default password is always `staff@123` and their username is their email address.

### Q: Can employee skip password change?

**A:** No. The password change dialog cannot be closed and must be completed to access the system. This is enforced at the application level.

### Q: What happens if email delivery fails?

**A:** Employee is still created successfully. Admin sees a warning and can:
- Click "Resend Email" button
- Copy credentials and share manually
- Contact employee via phone/other means

### Q: How long is default password valid?

**A:** Until first login and password change. After employee changes their password, the default password no longer works.

### Q: Can admin see employee's new password?

**A:** No. After employee changes their password, only the employee knows it. This is standard security practice.

---

## 🔄 Workflow Diagram

```
Admin Creates Employee
        ↓
System Generates Account
        ↓
firstLogin = "1" Set
        ↓
Welcome Email Sent Automatically
        ↓
Employee Receives Email
        ↓
Employee Logs In (email + staff@123)
        ↓
System Detects firstLogin = "1"
        ↓
Password Change Dialog (MANDATORY)
        ↓
Employee Creates New Password
        ↓
System Updates firstLogin = "0"
        ↓
Employee Access Dashboard
        ↓
Future Logins Use New Password
```

---

## 🎉 Benefits

### For Organization
- ✅ Consistent onboarding process
- ✅ Automated communication
- ✅ Security compliance
- ✅ Audit trail
- ✅ Reduced admin workload

### For Administrators
- ✅ Simple employee creation
- ✅ Automatic email sending
- ✅ Clear confirmation
- ✅ Easy to troubleshoot
- ✅ Less manual work

### For Employees
- ✅ Clear instructions
- ✅ Easy first login
- ✅ Forced security compliance
- ✅ Professional experience
- ✅ Quick onboarding

---

## 📞 Need Help?

**Administrators:**
- Review troubleshooting section
- Check activity logs
- Contact technical support

**Employees:**
- Check email carefully
- Follow step-by-step instructions
- Contact your supervisor
- Contact system administrator

---

**Document Version:** 1.0  
**Last Updated:** October 2025  
**Feedback:** support@amplodge.com

---

END OF GUIDE

