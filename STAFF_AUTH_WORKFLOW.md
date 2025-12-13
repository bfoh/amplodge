# Staff Authentication & Management System Workflow

## Overview
This document defines a comprehensive yet simple workflow for staff authentication and management in the AMP Lodge Hotel Management System. The admin user has exclusive rights to add staff members and assign roles.

---

## 1. User Roles Definition

### Admin Role
- **Full Access**: Complete control over the system
- **Exclusive Rights**: Only admins can add staff and assign roles
- **Permissions**: All CRUD operations on staff, rooms, bookings, guests, settings

### Staff Roles (Assigned by Admin)

#### Front Desk Staff
- View and create bookings
- Check-in/check-out guests
- View guest information
- Process onsite bookings
- View room availability
- **Cannot**: Manage staff, delete bookings, access financial reports

#### Housekeeping Staff
- View housekeeping tasks
- Update room cleaning status
- Mark tasks as complete
- View room status
- **Cannot**: Access bookings, manage staff, view financial data

#### Manager
- All Front Desk permissions
- View reports and analytics
- Manage rooms and room types
- View all bookings and history
- **Cannot**: Add/remove staff (admin only), change system settings

#### Accountant
- View all financial reports
- Generate invoices
- View booking revenue
- Access end-of-day reports
- **Cannot**: Create bookings, manage staff, change room status

---

## 2. Admin Authentication Workflow

### Initial Setup
1. **First Admin Account**
   - Created during system setup/seed
   - Email: admin@amplodge.com
   - Secure password generated
   - Role automatically set to "admin"

### Admin Login Process
1. Navigate to `/staff/login`
2. Enter email and password
3. System validates credentials
4. System checks `staff.role === "admin"`
5. If valid: Redirect to staff dashboard
6. If invalid: Show error message
7. Session token stored securely

### Admin Session Management
- Session expires after 24 hours of inactivity
- Refresh token used for extended sessions
- Logout clears all session data
- Multi-device login allowed (optional)

---

## 3. Staff Addition Workflow (Admin Only)

### Step 1: Access Staff Management
1. Admin logs in successfully
2. Navigates to **Employees** page via sidebar
3. System verifies admin role before displaying page
4. If not admin: Redirect to dashboard with "Access Denied" message

### Step 2: Add New Staff Member
1. Admin clicks **"Add Employee"** button
2. Modal/form appears with fields:
   - **Full Name** (required)
   - **Email Address** (required, unique)
   - **Phone Number** (optional)
   - **Role** (required, dropdown):
     - Front Desk Staff
     - Housekeeping Staff
     - Manager
     - Accountant
   - **Department** (optional)
   - **Hire Date** (optional)
   - **Initial Password** (auto-generated, displayed once)

### Step 3: Validation
- System checks if email already exists
- Validates email format
- Ensures role is selected
- Generates secure temporary password
- Creates Blink Auth user account

### Step 4: Account Creation
1. System creates entry in `staff` table:
   ```
   {
     id: auto-generated,
     user_id: from Blink Auth,
     name: entered name,
     email: entered email,
     role: selected role,
     created_at: timestamp
   }
   ```
2. System sends welcome email with:
   - Login credentials (email + temporary password)
   - Link to staff portal
   - Instructions to change password on first login

### Step 5: Confirmation
- Success message displayed to admin
- New staff member appears in staff list
- Admin can immediately assign/edit role if needed

---

## 4. Role Assignment Workflow

### Initial Assignment
- Role assigned during staff creation (as above)
- Stored in `staff.role` field
- Cannot be changed by the staff member themselves

### Role Modification (Admin Only)
1. Admin navigates to **Employees** page
2. Finds staff member in list
3. Clicks **"Edit"** or role dropdown
4. Selects new role from dropdown
5. Confirms change
6. System updates `staff.role` immediately
7. Staff member's permissions change on next login/session refresh

### Role Change Effects
- **Immediate**: New permissions applied
- **Session Handling**: Active sessions may require re-login for full effect
- **Audit**: Change logged with timestamp and admin user ID (optional enhancement)

---

## 5. Staff Authentication Workflow

### First-Time Login
1. New staff receives welcome email
2. Navigates to `/staff/login`
3. Enters email and temporary password
4. System detects first login
5. **Forced Password Change**:
   - Prompt to enter new password
   - Password strength validation (min 8 chars, mix of letters/numbers)
   - Confirm new password
   - Update password in Blink Auth
6. Redirect to dashboard based on role

### Subsequent Logins
1. Staff navigates to `/staff/login`
2. Enters email and password
3. System validates credentials via Blink Auth
4. System fetches staff record to get role
5. Generate session token with role embedded
6. Redirect to appropriate dashboard view
7. UI elements shown/hidden based on role

### Password Reset (Self-Service)
1. Staff clicks "Forgot Password" on login page
2. Enters email address
3. System sends password reset email via Blink
4. Staff clicks link in email
5. Enters new password
6. Password updated, redirected to login

---

## 6. Role-Based Access Control (RBAC) Rules

### Access Control Implementation

#### Route Protection
- Each protected route checks user's role on load
- Unauthorized roles redirected to dashboard with error message
- Routes accessible by role:

| Route                     | Admin | Manager | Front Desk | Housekeeping | Accountant |
|---------------------------|-------|---------|------------|--------------|------------|
| `/staff/dashboard`        | ✓     | ✓       | ✓          | ✓            | ✓          |
| `/staff/bookings`         | ✓     | ✓       | ✓          | ✗            | ✗          |
| `/staff/onsite-booking`   | ✓     | ✓       | ✓          | ✗            | ✗          |
| `/staff/guests`           | ✓     | ✓       | ✓          | ✗            | ✗          |
| `/staff/properties`       | ✓     | ✓       | ✗          | ✗            | ✗          |
| `/staff/housekeeping`     | ✓     | ✓       | ✗          | ✓            | ✗          |
| `/staff/reports`          | ✓     | ✓       | ✗          | ✗            | ✓          |
| `/staff/invoices`         | ✓     | ✓       | ✗          | ✗            | ✓          |
| `/staff/employees`        | ✓     | ✗       | ✗          | ✗            | ✗          |
| `/staff/settings`         | ✓     | ✗       | ✗          | ✗            | ✗          |

#### Feature-Level Permissions

**Bookings Management**
- **View**: Manager, Front Desk
- **Create**: Manager, Front Desk
- **Edit**: Manager, Front Desk
- **Delete/Cancel**: Admin, Manager only

**Staff Management**
- **View Staff List**: Admin only
- **Add Staff**: Admin only
- **Edit Staff Role**: Admin only
- **Remove Staff**: Admin only

**Room Management**
- **View**: All roles
- **Edit Status**: Admin, Manager, Housekeeping
- **Add/Remove Rooms**: Admin, Manager only

**Financial Operations**
- **View Reports**: Admin, Manager, Accountant
- **Generate Invoices**: Admin, Accountant
- **View Revenue**: Admin, Manager, Accountant

#### UI Element Visibility
- Sidebar menu items shown/hidden based on role
- Action buttons disabled for unauthorized roles
- Sensitive data fields hidden from unauthorized users

---

## 7. Staff Removal Workflow (Admin Only)

### Deactivation (Recommended)
1. Admin navigates to Employees page
2. Finds staff member
3. Clicks "Deactivate" or toggles status to "Inactive"
4. Staff cannot log in but record preserved for audit
5. Can be reactivated later by admin

### Permanent Deletion (Caution)
1. Admin navigates to Employees page
2. Finds staff member
3. Clicks "Delete" button
4. Confirmation dialog: "Are you sure? This cannot be undone."
5. If confirmed:
   - Delete from `staff` table
   - Optionally delete Blink Auth user
   - Related activity logs preserved (if implemented)

---

## 8. Security Considerations

### Password Policies
- Minimum 8 characters
- Must contain letters and numbers (optional: special chars)
- Passwords hashed before storage
- Temporary passwords expire after 24 hours

### Session Security
- Tokens stored securely (httpOnly cookies recommended)
- CSRF protection enabled
- Session timeout after inactivity
- Automatic logout on multiple failed attempts

### Admin Account Protection
- Admin role cannot be changed by anyone except another admin
- At least one admin account must exist at all times
- Admin actions optionally logged for audit

### Role Validation
- Role checked on every protected API call
- Frontend role checks supplemented by backend validation
- Roles cannot be modified via client-side manipulation

---

## 9. Dashboard Views by Role

### Admin Dashboard
- Overview stats: bookings, revenue, occupancy
- Quick actions: Add staff, view reports, manage rooms
- Recent activity feed
- Full sidebar navigation

### Manager Dashboard
- Booking overview: today's check-ins/check-outs
- Room status summary
- Revenue today/this week
- Quick actions: Create booking, view calendar
- Limited sidebar (no staff management)

### Front Desk Dashboard
- Today's arrivals and departures
- Room availability
- Quick check-in/check-out buttons
- Recent bookings list
- Limited sidebar (no reports, no staff)

### Housekeeping Dashboard
- List of rooms to clean
- Task completion status
- Room status overview
- Quick actions: Mark room clean, view tasks
- Minimal sidebar (only housekeeping features)

### Accountant Dashboard
- Revenue summary: today, week, month
- Recent invoices
- Outstanding payments
- Quick actions: Generate invoice, view reports
- Limited sidebar (financial features only)

---

## 10. Error Handling & Edge Cases

### Invalid Login
- Display clear error message
- Don't reveal if email exists (security)
- Rate limiting after 5 failed attempts

### Role Mismatch
- User tries to access unauthorized page
- Redirect to dashboard
- Show toast notification: "Access denied"

### Admin Deleting Last Admin
- System prevents deletion/deactivation
- Show error: "Cannot remove the last admin account"

### Staff Account Conflict
- Email already exists during staff creation
- Show error: "This email is already registered"
- Suggest checking existing staff list

### Session Expiry
- Detect expired session on API call
- Redirect to login
- Show message: "Session expired, please log in again"

---

## 11. Implementation Summary

### Database Schema (Already Exists)
```sql
staff table:
- id: TEXT (PK)
- user_id: TEXT (NOT NULL) -- Links to Blink Auth user
- name: TEXT (NOT NULL)
- email: TEXT (NOT NULL)
- role: TEXT (DEFAULT 'staff')
- created_at: TEXT (DEFAULT CURRENT_TIMESTAMP)
```

### Key Workflow Steps
1. **Admin Setup**: Seed initial admin account
2. **Admin Login**: Authenticate via Blink Auth, fetch role
3. **Add Staff**: Admin creates staff with role selection
4. **Staff Login**: Staff authenticates, role-based redirect
5. **Role Check**: Every page/action validates role
6. **Role Update**: Admin can change staff roles anytime
7. **Deactivate/Delete**: Admin can remove staff access

### Frontend Components Needed
- Staff login page (already exists)
- Add staff modal/form (already exists)
- Role selector dropdown
- Protected route wrapper component
- Role-based sidebar menu
- Permission checker utility

### Backend/API Considerations
- Blink Auth handles password management
- `staff` table stores role and metadata
- API calls must verify user role before executing
- Use Blink SDK `auth.me()` to get current user
- Match `user.id` with `staff.user_id` to fetch role

---

## 12. User Experience Flow Diagram

```
┌─────────────────────────────────────────────────────────┐
│                    Admin Workflow                        │
└─────────────────────────────────────────────────────────┘
1. Admin logs in → 2. Views Employees page → 3. Clicks "Add Employee"
   ↓
4. Fills form (name, email, role) → 5. System validates → 6. Creates staff account
   ↓
7. Welcome email sent to staff → 8. Staff appears in admin's list
   ↓
9. Admin can edit role or deactivate later

┌─────────────────────────────────────────────────────────┐
│                    Staff Workflow                        │
└─────────────────────────────────────────────────────────┘
1. Staff receives welcome email → 2. Navigates to login
   ↓
3. Enters email + temp password → 4. System forces password change
   ↓
5. Sets new password → 6. Redirected to role-based dashboard
   ↓
7. Sidebar shows only permitted features
   ↓
8. Staff performs daily tasks within their role permissions
```

---

## Conclusion

This workflow ensures:
- **Exclusive Admin Control**: Only admins add/manage staff
- **Clear Role Hierarchy**: Each role has specific permissions
- **Security**: Password policies, session management, RBAC enforcement
- **Simplicity**: Easy to understand and implement
- **Scalability**: Can add more roles or permissions later

The system is ready for implementation with clear business rules and user interactions defined.
