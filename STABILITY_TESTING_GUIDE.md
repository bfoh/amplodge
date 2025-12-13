# Stability Testing Guide

**Version:** 1.0  
**Date:** October 2025  
**Purpose:** Comprehensive testing checklist for AMP Lodge stability

---

## 🎯 Testing Overview

This guide ensures all stability improvements are working correctly across:
- Authentication & Authorization
- Navigation & Routing
- Error Handling
- Loading States
- User Experience

---

## ✅ Critical Path Testing

### 1. Authentication Flow

#### Test 1.1: Admin Login
```
Steps:
1. Visit http://localhost:5173/staff/login
2. Enter: admin@amplodge.com / AdminAMP2025!
3. Click "Sign In"

Expected:
✅ Loading spinner shows during authentication
✅ Success message: "Welcome back, Admin User!"
✅ Redirected to /staff/dashboard
✅ No console errors
✅ Navigation fully visible
✅ Admin section visible

Actual: [ ] Pass [ ] Fail
Notes: _________________________________
```

#### Test 1.2: Wrong Password
```
Steps:
1. Visit http://localhost:5173/staff/login
2. Enter: admin@amplodge.com / WrongPassword
3. Click "Sign In"

Expected:
✅ Error toast shows
✅ Stays on login page
✅ No redirect occurs
✅ Form is still usable

Actual: [ ] Pass [ ] Fail
Notes: _________________________________
```

#### Test 1.3: Non-Staff User
```
Steps:
1. Create non-staff user account
2. Try to login at /staff/login

Expected:
✅ Error: "You do not have staff access"
✅ User is logged out
✅ Stays on login page

Actual: [ ] Pass [ ] Fail
Notes: _________________________________
```

#### Test 1.4: First-Time Login
```
Steps:
1. Create new staff member with temp password
2. Login with temp password

Expected:
✅ Password change dialog shows
✅ Cannot close dialog without changing password
✅ Password must be 8+ characters
✅ Passwords must match
✅ After change, redirected to dashboard

Actual: [ ] Pass [ ] Fail
Notes: _________________________________
```

#### Test 1.5: Logout
```
Steps:
1. Login as any staff member
2. Click logout button

Expected:
✅ Redirected to /staff/login
✅ Cannot access protected routes
✅ Session is cleared

Actual: [ ] Pass [ ] Fail
Notes: _________________________________
```

---

### 2. Navigation & Routing

#### Test 2.1: Protected Route Access
```
Steps:
1. While logged out, try to visit /staff/dashboard

Expected:
✅ Redirected to /staff/login
✅ No flash of protected content

Actual: [ ] Pass [ ] Fail
Notes: _________________________________
```

#### Test 2.2: Role-Based Navigation
```
Steps:
1. Login as staff member (not admin)
2. Check visible navigation items

Expected:
✅ Basic pages visible (Dashboard, Bookings, etc.)
✅ Employees tab NOT visible
✅ Invoices tab NOT visible
✅ Admin section NOT visible

Actual: [ ] Pass [ ] Fail
Notes: _________________________________
```

#### Test 2.3: Admin Navigation
```
Steps:
1. Login as admin
2. Check visible navigation items

Expected:
✅ All basic pages visible
✅ Employees tab visible
✅ Invoices tab visible
✅ Admin section visible

Actual: [ ] Pass [ ] Fail
Notes: _________________________________
```

#### Test 2.4: Page Refresh Stability
```
Steps:
1. Login as admin
2. Navigate to /staff/employees
3. Press F5 to refresh

Expected:
✅ Page loads without errors
✅ Navigation stays visible
✅ Employees tab remains visible
✅ No "Access Denied" errors
✅ Content loads properly

Actual: [ ] Pass [ ] Fail
Notes: _________________________________
```

#### Test 2.5: Direct URL Access
```
Steps:
1. Login as staff (not admin)
2. Type /staff/employees in URL bar

Expected:
✅ Access denied toast shows
✅ Redirected to /staff/dashboard
✅ Error message is clear

Actual: [ ] Pass [ ] Fail
Notes: _________________________________
```

---

### 3. Error Handling

#### Test 3.1: Error Boundary Catch
```
Steps:
1. Force a React error (e.g., render null.property)
2. Check error boundary appears

Expected:
✅ Error boundary UI shows
✅ "Something went wrong" message
✅ "Reload Page" button works
✅ "Go to Homepage" button works
✅ App doesn't crash completely

Actual: [ ] Pass [ ] Fail
Notes: _________________________________
```

#### Test 3.2: Network Error Handling
```
Steps:
1. Disable network (Dev Tools -> Network -> Offline)
2. Try to login

Expected:
✅ Error message shows
✅ User informed of network issue
✅ Can retry when network returns

Actual: [ ] Pass [ ] Fail
Notes: _________________________________
```

#### Test 3.3: Database Error Handling
```
Steps:
1. Force a database error
2. Observe error handling

Expected:
✅ Error logged to console
✅ User sees friendly error message
✅ App remains functional
✅ Can recover from error

Actual: [ ] Pass [ ] Fail
Notes: _________________________________
```

---

### 4. Loading States

#### Test 4.1: Login Loading State
```
Steps:
1. Click "Sign In" button
2. Observe loading state

Expected:
✅ Button shows "Signing in..."
✅ Button is disabled during load
✅ Spinner visible
✅ Form can't be submitted again

Actual: [ ] Pass [ ] Fail
Notes: _________________________________
```

#### Test 4.2: Page Loading State
```
Steps:
1. Navigate to any page
2. Observe loading behavior

Expected:
✅ Loading spinner shows
✅ "Checking permissions..." message
✅ Smooth transition to content
✅ No content flash

Actual: [ ] Pass [ ] Fail
Notes: _________________________________
```

#### Test 4.3: Data Loading State
```
Steps:
1. Visit /staff/employees
2. Observe data loading

Expected:
✅ Loading card shows
✅ "Loading employees..." message
✅ Spinner visible
✅ Smooth transition to table

Actual: [ ] Pass [ ] Fail
Notes: _________________________________
```

---

### 5. User Experience

#### Test 5.1: No Navigation Flicker
```
Steps:
1. Login as admin
2. Refresh page multiple times
3. Navigate between pages

Expected:
✅ Navigation items don't disappear/reappear
✅ No visual glitches
✅ Smooth transitions
✅ Consistent appearance

Actual: [ ] Pass [ ] Fail
Notes: _________________________________
```

#### Test 5.2: Clear Error Messages
```
Steps:
1. Trigger various errors
2. Read error messages

Expected:
✅ Messages are clear and helpful
✅ Tell user what went wrong
✅ Suggest how to fix
✅ Professional tone

Actual: [ ] Pass [ ] Fail
Notes: _________________________________
```

#### Test 5.3: Responsive Design
```
Steps:
1. Test on desktop (1920px)
2. Test on tablet (768px)
3. Test on mobile (375px)

Expected:
✅ All pages work on all sizes
✅ Navigation accessible
✅ Forms usable
✅ Content readable

Actual: [ ] Pass [ ] Fail
Notes: _________________________________
```

---

## 🔄 Regression Testing

### Areas to Check After Updates

#### After Auth Changes:
- [ ] Can login with all user types
- [ ] Logout works correctly
- [ ] Protected routes still protected
- [ ] Role permissions still work

#### After UI Changes:
- [ ] Navigation still visible
- [ ] Loading states still show
- [ ] Error boundaries still catch
- [ ] Responsive design maintained

#### After Database Changes:
- [ ] Data loads correctly
- [ ] Errors handled gracefully
- [ ] Loading states work
- [ ] No data loss

---

## 🚨 Critical Bugs to Watch For

### High Priority Issues

1. **Login Fails Completely**
   - Can't access any part of app
   - Severity: 🔴 Critical
   - Action: Revert last changes immediately

2. **Navigation Disappears**
   - Can't navigate between pages
   - Severity: 🔴 Critical
   - Action: Check StaffSidebar/AppLayout

3. **App Crashes on Error**
   - Error boundary not catching
   - Severity: 🔴 Critical
   - Action: Check ErrorBoundary component

4. **Race Condition Returns**
   - Duplicate staff records
   - Multiple auth calls
   - Severity: 🟡 High
   - Action: Check App.tsx useEffect

5. **Access Denied on Refresh**
   - Admin loses access on refresh
   - Severity: 🟡 High
   - Action: Check ProtectedRoute logic

---

## 🧪 Automated Test Examples

### Jest Tests (Future)

```typescript
describe('Authentication', () => {
  it('should login admin successfully', async () => {
    // Test implementation
  })
  
  it('should deny access to non-staff', async () => {
    // Test implementation
  })
})

describe('Error Boundary', () => {
  it('should catch errors gracefully', () => {
    // Test implementation
  })
})
```

### Cypress Tests (Future)

```typescript
describe('Login Flow', () => {
  it('completes full login flow', () => {
    cy.visit('/staff/login')
    cy.get('[id=email]').type('admin@amplodge.com')
    cy.get('[id=password]').type('AdminAMP2025!')
    cy.get('button[type=submit]').click()
    cy.url().should('include', '/staff/dashboard')
  })
})
```

---

## 📊 Test Results Template

### Test Session

**Date:** __________________  
**Tester:** __________________  
**Version:** __________________  
**Browser:** __________________

### Results Summary

| Category | Tests | Passed | Failed | Notes |
|----------|-------|--------|--------|-------|
| Authentication | 5 | ___ | ___ | ______ |
| Navigation | 5 | ___ | ___ | ______ |
| Error Handling | 3 | ___ | ___ | ______ |
| Loading States | 3 | ___ | ___ | ______ |
| User Experience | 3 | ___ | ___ | ______ |
| **Total** | **19** | ___ | ___ | ______ |

### Issues Found

1. ________________________________________________
   Severity: [ ] Critical [ ] High [ ] Medium [ ] Low
   
2. ________________________________________________
   Severity: [ ] Critical [ ] High [ ] Medium [ ] Low

### Sign-off

**Tested By:** ____________________  
**Approved:** [ ] Yes [ ] No  
**Ready for Production:** [ ] Yes [ ] No  
**Comments:** ________________________________________

---

## 🔍 Debugging Tips

### Common Issues

**Issue:** Can't login
- Check console for errors
- Verify admin account exists
- Check network tab for failed requests
- Try clearing browser cache

**Issue:** Navigation missing
- Check role is loading properly
- Look for `[useStaffRole]` logs in console
- Verify `canManageEmployees` value
- Check StaffSidebar filtering logic

**Issue:** Access denied on refresh
- Check ProtectedRoute logs
- Verify retry logic is working
- Check role loads before permission check
- Look for race conditions

**Issue:** Errors not caught
- Verify ErrorBoundary is in place
- Check component hierarchy
- Look for errors outside React tree
- Check async error handling

---

## 📞 Support Contacts

**Development Team:** dev@amplodge.com  
**QA Team:** qa@amplodge.com  
**Support:** support@amplodge.com

---

## ✅ Sign-off

**Guide Version:** 1.0  
**Last Updated:** October 2025  
**Next Review:** After major updates

**Approved By:** ____________________  
**Date:** ____________________

---

END OF TESTING GUIDE

