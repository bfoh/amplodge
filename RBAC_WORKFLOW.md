# Role-Based Access Control (RBAC) Implementation Workflow

## Overview

This document outlines the comprehensive RBAC system implemented in the AMP Lodge property management system. The system provides granular access control across four role levels with seamless integration throughout the application.

## Table of Contents

1. [Role Hierarchy](#role-hierarchy)
2. [Architecture](#architecture)
3. [Implementation Guide](#implementation-guide)
4. [Permission System](#permission-system)
5. [Usage Patterns](#usage-patterns)
6. [Best Practices](#best-practices)
7. [Security Considerations](#security-considerations)

---

## Role Hierarchy

### 1. Staff (Level 1)
**Access:** Basic operations only
- ✅ View and update bookings
- ✅ View and update guest information
- ✅ View and update housekeeping status
- ✅ Access calendar
- ❌ Cannot delete records
- ❌ Cannot access financial reports
- ❌ Cannot manage employees
- ❌ Cannot modify system settings

**Use Case:** Front desk staff, housekeeping staff

### 2. Manager (Level 2)
**Access:** Supervisory operations
- ✅ All Staff permissions
- ✅ Create and manage properties
- ✅ Access reports and analytics
- ✅ Delete bookings (with oversight)
- ❌ Cannot manage employees
- ❌ Cannot access invoices
- ❌ Cannot modify system settings

**Use Case:** Property managers, shift supervisors

### 3. Admin (Level 3)
**Access:** Full operational control
- ✅ All Manager permissions
- ✅ Manage employees (except owners)
- ✅ Create and manage invoices
- ✅ Configure system settings
- ✅ Manage channels and integrations
- ✅ Assign roles up to Admin level
- ❌ Cannot manage owners
- ❌ Cannot assign owner role

**Use Case:** Property administrators, operations managers

### 4. Owner (Level 4)
**Access:** Complete system access
- ✅ All Admin permissions
- ✅ Manage all employees including admins
- ✅ Assign any role including owner
- ✅ Full system configuration
- ✅ Access all sensitive operations
- ✅ Override any permission

**Use Case:** Property owners, system administrators

---

## Architecture

### Core Components

```
src/
├── lib/
│   └── rbac.ts                    # Core RBAC logic and utilities
├── hooks/
│   ├── use-staff-role.tsx         # Staff role state management
│   └── use-permissions.tsx        # Permission checking hook (NEW)
├── components/
│   ├── ProtectedRoute.tsx         # Route-level protection
│   ├── Permission.tsx             # Component-level permission wrapper (NEW)
│   └── layout/
│       └── StaffSidebar.tsx       # RBAC-aware navigation
└── pages/
    └── staff/                     # Protected staff pages
```

### Data Flow

```
User Authentication (Blink Auth)
    ↓
Staff Record Lookup (useStaffRole hook)
    ↓
Role & Permissions Loading
    ↓
Permission Checks (Route, Component, Action levels)
    ↓
UI Rendering / Action Execution
```

---

## Implementation Guide

### Step 1: Role Definition (Already Implemented)

Located in `src/lib/rbac.ts`:

```typescript
export type StaffRole = 'staff' | 'manager' | 'admin' | 'owner'
```

### Step 2: Permission Configuration

Permissions are defined per resource with CRUD actions:

```typescript
export const ROLE_PERMISSIONS: Record<StaffRole, Permission[]> = {
  owner: [
    { resource: '*', actions: ['create', 'read', 'update', 'delete'] }
  ],
  admin: [
    { resource: 'employees', actions: ['create', 'read', 'update', 'delete'] },
    { resource: 'bookings', actions: ['create', 'read', 'update', 'delete'] },
    // ... more resources
  ],
  // ... other roles
}
```

### Step 3: Route Protection

Routes are protected using the `ProtectedRoute` component:

```typescript
// In App.tsx
<Route path="/staff" element={<ProtectedRoute><AppLayout /></ProtectedRoute>}>
  <Route path="employees" element={<EmployeesPage />} />
  {/* Route access is checked in ProtectedRoute */}
</Route>
```

Route access is defined in `ROUTE_ACCESS`:

```typescript
export const ROUTE_ACCESS: Record<string, StaffRole[]> = {
  '/staff/employees': ['owner', 'admin'],
  '/staff/reports': ['owner', 'admin', 'manager'],
  // ... more routes
}
```

### Step 4: Component-Level Protection

Use the `useStaffRole` hook for component-level checks:

```typescript
import { useStaffRole } from '@/hooks/use-staff-role'
import { hasPermission } from '@/lib/rbac'

function MyComponent() {
  const { role, canManageEmployees } = useStaffRole()
  
  // Show/hide UI based on permissions
  return (
    <>
      {canManageEmployees && (
        <Button>Add Employee</Button>
      )}
    </>
  )
}
```

### Step 5: Action-Level Protection

Check permissions before executing sensitive actions:

```typescript
import { hasPermission } from '@/lib/rbac'
import { useStaffRole } from '@/hooks/use-staff-role'

async function handleDelete(employee: StaffMember) {
  const { role } = useStaffRole()
  
  if (!role || !hasPermission(role, 'employees', 'delete')) {
    toast.error('You do not have permission to delete employees')
    return
  }
  
  // Check if can manage this specific employee
  if (!canManageStaff(role, employee.role)) {
    toast.error('You cannot delete this employee')
    return
  }
  
  // Proceed with deletion
  await deleteEmployee(employee.id)
}
```

---

## Permission System

### Resources

The following resources have defined permissions:

- `employees` - Staff management
- `bookings` - Reservation management
- `properties` - Room and property management
- `guests` - Guest information management
- `reports` - Analytics and reporting
- `invoices` - Financial documents
- `housekeeping` - Room status management
- `settings` - System configuration

### Actions

Four basic CRUD actions:
- `create` - Create new records
- `read` - View records
- `update` - Modify existing records
- `delete` - Remove records

### Permission Check Functions

#### `hasPermission(userRole, resource, action)`
Checks if a role has permission for a specific action on a resource.

```typescript
if (hasPermission('admin', 'employees', 'delete')) {
  // Allow deletion
}
```

#### `canAccessRoute(route, userRole)`
Checks if a role can access a specific route.

```typescript
if (canAccessRoute('/staff/employees', userRole)) {
  // Show navigation item
}
```

#### `canManageStaff(actorRole, targetRole)`
Checks if one role can manage another role.

```typescript
if (canManageStaff('admin', 'staff')) {
  // Admin can manage staff members
}
```

#### `canAssignRole(actorRole, targetRole)`
Checks if a role can assign another role.

```typescript
if (canAssignRole('admin', 'manager')) {
  // Admin can assign manager role
}
```

---

## Usage Patterns

### Pattern 1: Conditional Rendering

```typescript
import { useStaffRole } from '@/hooks/use-staff-role'

function Toolbar() {
  const { canManageEmployees, isOwner } = useStaffRole()
  
  return (
    <div>
      {canManageEmployees && <Button>Add Employee</Button>}
      {isOwner && <Button>System Settings</Button>}
    </div>
  )
}
```

### Pattern 2: Route Guards

```typescript
// Already implemented in ProtectedRoute component
// Automatically checks route access based on user role
```

### Pattern 3: Action Validation

```typescript
import { canManageStaff } from '@/lib/rbac'
import { useStaffRole } from '@/hooks/use-staff-role'

function handleEditEmployee(employee: StaffMember) {
  const { role } = useStaffRole()
  
  if (!role || !canManageStaff(role, employee.role)) {
    toast.error('Permission denied')
    return
  }
  
  // Proceed with edit
}
```

### Pattern 4: Dynamic Navigation

```typescript
import { getVisibleNavItems } from '@/lib/rbac'
import { useStaffRole } from '@/hooks/use-staff-role'

function Navigation() {
  const { role } = useStaffRole()
  const navItems = role ? getVisibleNavItems(role) : []
  
  return (
    <nav>
      {navItems.map(item => (
        <NavLink to={item.path}>{item.label}</NavLink>
      ))}
    </nav>
  )
}
```

### Pattern 5: Optimistic UI with Permission Checks

```typescript
async function handleCreate(data: EmployeeFormValues) {
  const { role } = useStaffRole()
  
  // Check permissions first
  if (!hasPermission(role, 'employees', 'create')) {
    toast.error('You do not have permission to create employees')
    return
  }
  
  // Optimistically add to UI
  setEmployees(prev => [...prev, optimisticEmployee])
  
  try {
    await createEmployee(data)
  } catch (error) {
    // Rollback on error
    setEmployees(prev => prev.filter(e => e.id !== optimisticEmployee.id))
  }
}
```

---

## Best Practices

### 1. Always Check Permissions at Multiple Levels

✅ **Do:**
```typescript
// Check at route level (ProtectedRoute)
// Check at component level (conditional rendering)
// Check at action level (before mutation)
```

❌ **Don't:**
```typescript
// Only check at UI level - can be bypassed
{isAdmin && <Button onClick={deleteAll}>Delete All</Button>}
```

### 2. Use Helper Flags from useStaffRole

✅ **Do:**
```typescript
const { canManageEmployees, isOwner } = useStaffRole()
if (canManageEmployees) { /* ... */ }
```

❌ **Don't:**
```typescript
const { role } = useStaffRole()
if (role === 'admin' || role === 'owner') { /* ... */ }
```

### 3. Provide Clear Feedback

✅ **Do:**
```typescript
if (!hasPermission(role, 'employees', 'delete')) {
  toast.error('You do not have permission to delete employees')
  return
}
```

❌ **Don't:**
```typescript
if (!hasPermission(role, 'employees', 'delete')) {
  return // Silent failure
}
```

### 4. Log Sensitive Actions

✅ **Do:**
```typescript
await blink.db.activityLogs.create({
  userId: currentUser.id,
  action: 'deleted',
  entityType: 'employee',
  entityId: employee.id,
  details: JSON.stringify({ /* ... */ }),
  createdAt: new Date().toISOString()
})
```

### 5. Handle Role Changes Gracefully

✅ **Do:**
```typescript
const { refreshRole } = useStaffRole()

// After role update
await refreshRole()
window.dispatchEvent(new Event('refreshStaffRole'))
```

---

## Security Considerations

### 1. Server-Side Validation
⚠️ **Important:** Always validate permissions on the server side. Client-side checks are for UX only.

### 2. Sensitive Data Protection
- Never expose sensitive data in client-side code
- Use role checks before displaying financial information
- Mask sensitive fields for lower-level roles

### 3. Audit Trail
- Log all permission-sensitive actions
- Track who performed what action and when
- Store actor role at time of action

### 4. Role Escalation Prevention
```typescript
// Prevent admins from promoting themselves to owner
if (actorRole === 'admin' && targetRole === 'owner') {
  return false
}

// Prevent editing users with higher privilege
if (getRoleLevel(targetRole) >= getRoleLevel(actorRole)) {
  return false
}
```

### 5. Session Management
- Refresh role information after assignment changes
- Handle concurrent sessions appropriately
- Invalidate sessions when role is removed

---

## Testing RBAC

### Manual Testing Checklist

1. **Staff Role:**
   - [ ] Can access bookings, guests, calendar
   - [ ] Cannot access employees, invoices, reports
   - [ ] Cannot delete records
   - [ ] Navigation shows only allowed items

2. **Manager Role:**
   - [ ] Can access all staff features + reports
   - [ ] Cannot access employees or invoices
   - [ ] Can delete bookings
   - [ ] Can manage properties

3. **Admin Role:**
   - [ ] Can access all manager features + admin pages
   - [ ] Can manage staff and managers
   - [ ] Cannot manage owners
   - [ ] Can assign roles up to admin

4. **Owner Role:**
   - [ ] Can access everything
   - [ ] Can manage all employees including admins
   - [ ] Can assign owner role
   - [ ] Has override capability

### Test Accounts

```typescript
// Create test accounts for each role
const testAccounts = [
  { email: 'staff@test.com', role: 'staff' },
  { email: 'manager@test.com', role: 'manager' },
  { email: 'admin@test.com', role: 'admin' },
  { email: 'owner@test.com', role: 'owner' }
]
```

---

## Troubleshooting

### Issue: User has no role after login
**Solution:** Ensure staff record exists in database with correct userId

```typescript
// Check staff record
const staff = await blink.db.staff.list({ 
  where: { userId: user.id } 
})
```

### Issue: Navigation items not showing
**Solution:** Verify role is loaded before rendering navigation

```typescript
const { role, loading } = useStaffRole()
if (loading) return <Loader />
```

### Issue: Permission denied despite correct role
**Solution:** Check route path matches ROUTE_ACCESS exactly

```typescript
// Route paths must match exactly
'/staff/employees' !== '/staff/employees/'
```

### Issue: Role not updating after assignment
**Solution:** Trigger role refresh

```typescript
const { refreshRole } = useStaffRole()
await refreshRole()
// Or dispatch event
window.dispatchEvent(new Event('refreshStaffRole'))
```

---

## Future Enhancements

### Planned Features

1. **Fine-Grained Permissions**
   - Per-property permissions
   - Time-based access restrictions
   - Feature flags per role

2. **Permission Templates**
   - Pre-defined permission sets
   - Custom role creation
   - Permission inheritance

3. **Advanced Audit Logging**
   - Real-time activity monitoring
   - Permission violation alerts
   - Audit log search and filtering

4. **Multi-Tenant Support**
   - Organization-level roles
   - Cross-property permissions
   - Tenant isolation

---

## API Reference

### Core Functions

```typescript
// Permission checks
hasPermission(userRole: StaffRole, resource: string, action: Action): boolean
canAccessRoute(route: string, userRole: StaffRole): boolean
canManageStaff(actorRole: StaffRole, targetRole: StaffRole): boolean
canAssignRole(actorRole: StaffRole, targetRole: StaffRole): boolean

// Role utilities
getRoleLevel(role: StaffRole): number
getRoleDisplay(role: StaffRole): string
getRoleDescription(role: StaffRole): string
getAccessibleRoutes(userRole: StaffRole): string[]
getVisibleNavItems(userRole: StaffRole): NavItem[]
```

### useStaffRole Hook

```typescript
const {
  role,           // Current user role
  staffRecord,    // Full staff record
  loading,        // Loading state
  userId,         // Current user ID
  refreshRole,    // Function to refresh role
  isOwner,        // Boolean helper
  isAdmin,        // Boolean helper
  isManager,      // Boolean helper
  isStaff,        // Boolean helper
  canManageEmployees  // Boolean helper
} = useStaffRole()
```

---

## Conclusion

This RBAC system provides a robust, scalable foundation for access control in the AMP Lodge system. By following the patterns and best practices outlined in this document, you can ensure secure, maintainable, and user-friendly permission management.

For questions or issues, refer to the troubleshooting section or consult the source code in `src/lib/rbac.ts`.

---

**Document Version:** 1.0  
**Last Updated:** October 2025  
**Maintained By:** AMP Lodge Development Team

