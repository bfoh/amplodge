# RBAC Usage Examples

This document provides practical examples of how to use the Role-Based Access Control (RBAC) system throughout your application.

## Table of Contents

1. [Using the usePermissions Hook](#using-the-usepermissions-hook)
2. [Using the Permission Component](#using-the-permission-component)
3. [Action-Level Checks](#action-level-checks)
4. [Page-Level Guards](#page-level-guards)
5. [Navigation Control](#navigation-control)
6. [Common Patterns](#common-patterns)

---

## Using the usePermissions Hook

### Basic Permission Check

```typescript
import { usePermissions } from '@/hooks/use-permissions'

function MyComponent() {
  const permissions = usePermissions()
  
  if (permissions.loading) {
    return <Loader />
  }
  
  return (
    <div>
      {permissions.can('employees', 'create') && (
        <Button>Add Employee</Button>
      )}
    </div>
  )
}
```

### Check Multiple Permissions

```typescript
function BookingActions() {
  const permissions = usePermissions()
  
  // Check if user can perform all these actions
  const canFullyManage = permissions.canAll([
    { resource: 'bookings', action: 'create' },
    { resource: 'bookings', action: 'update' },
    { resource: 'bookings', action: 'delete' }
  ])
  
  // Check if user can perform any of these actions
  const hasAnyAccess = permissions.canAny([
    { resource: 'bookings', action: 'read' },
    { resource: 'guests', action: 'read' }
  ])
  
  return (
    <div>
      {canFullyManage && <Button>Full Management</Button>}
      {hasAnyAccess && <Button>View Data</Button>}
    </div>
  )
}
```

### Convenience Methods

```typescript
function QuickChecks() {
  const permissions = usePermissions()
  
  return (
    <div>
      {/* Using convenience aliases */}
      {permissions.canCreate('employees') && <CreateButton />}
      {permissions.canRead('reports') && <ReportsLink />}
      {permissions.canUpdate('settings') && <SettingsButton />}
      {permissions.canDelete('bookings') && <DeleteButton />}
      
      {/* Role checks */}
      {permissions.isAdmin && <AdminPanel />}
      {permissions.isOwner && <OwnerSettings />}
      {permissions.canManageEmployees && <EmployeesLink />}
    </div>
  )
}
```

---

## Using the Permission Component

### Basic Resource Permission

```typescript
import { Permission } from '@/components/Permission'

function EmployeeActions({ employee }) {
  return (
    <div>
      {/* Show button only if user can delete employees */}
      <Permission resource="employees" action="delete">
        <Button onClick={() => handleDelete(employee)}>
          Delete Employee
        </Button>
      </Permission>
      
      {/* Show button only if user can update employees */}
      <Permission resource="employees" action="update">
        <Button onClick={() => handleEdit(employee)}>
          Edit Employee
        </Button>
      </Permission>
    </div>
  )
}
```

### Route Access Check

```typescript
function Navigation() {
  return (
    <nav>
      {/* Show link only if user can access the route */}
      <Permission route="/staff/employees">
        <NavLink to="/staff/employees">Employees</NavLink>
      </Permission>
      
      <Permission route="/staff/reports">
        <NavLink to="/staff/reports">Reports</NavLink>
      </Permission>
    </nav>
  )
}
```

### Role-Based Display

```typescript
function RoleSpecificContent() {
  return (
    <div>
      {/* Show only for admin */}
      <Permission role="admin">
        <AdminTools />
      </Permission>
      
      {/* Show for manager or above */}
      <Permission minRole="manager">
        <ManagerDashboard />
      </Permission>
      
      {/* Show for any role except staff */}
      <Permission check={() => {
        const { role } = usePermissions()
        return role !== 'staff'
      }}>
        <AdvancedFeatures />
      </Permission>
    </div>
  )
}
```

### Management Checks

```typescript
function EmployeeRow({ employee }) {
  return (
    <tr>
      <td>{employee.name}</td>
      <td>{employee.role}</td>
      <td>
        {/* Can this user manage this employee? */}
        <Permission canManage targetRole={employee.role}>
          <Button onClick={() => handleEdit(employee)}>Edit</Button>
        </Permission>
        
        {/* Can this user assign this role? */}
        <Permission canAssign targetRole="admin">
          <Select>
            <SelectItem value="admin">Admin</SelectItem>
          </Select>
        </Permission>
      </td>
    </tr>
  )
}
```

### With Fallback Content

```typescript
function ProtectedContent() {
  return (
    <Permission 
      resource="reports" 
      action="read"
      fallback={
        <div className="text-center py-8">
          <ShieldAlert className="w-12 h-12 mx-auto text-muted-foreground" />
          <p>You don't have access to reports</p>
        </div>
      }
    >
      <ReportsContent />
    </Permission>
  )
}
```

---

## Action-Level Checks

### Before Create/Update/Delete

```typescript
async function handleCreateEmployee(data: EmployeeFormValues) {
  const permissions = usePermissions()
  
  // Check permission before action
  if (!permissions.can('employees', 'create')) {
    toast.error('Permission denied', {
      description: 'You do not have permission to create employees'
    })
    return
  }
  
  // Check if can assign this role
  if (!permissions.canAssign(data.role)) {
    toast.error('Cannot assign this role', {
      description: `You do not have permission to assign the ${data.role} role`
    })
    return
  }
  
  // Proceed with creation
  await createEmployee(data)
}
```

### Before Deletion

```typescript
async function handleDeleteEmployee(employee: StaffMember) {
  const permissions = usePermissions()
  
  // Check delete permission
  if (!permissions.can('employees', 'delete')) {
    toast.error('Permission denied')
    return
  }
  
  // Check if can manage this specific employee
  if (!permissions.canManage(employee.role)) {
    toast.error('Cannot delete this employee', {
      description: 'You cannot delete employees with this role'
    })
    return
  }
  
  // Proceed with deletion
  if (confirm('Are you sure?')) {
    await deleteEmployee(employee.id)
  }
}
```

### Before Update

```typescript
async function handleUpdateProperty(id: string, data: PropertyData) {
  const permissions = usePermissions()
  
  if (!permissions.can('properties', 'update')) {
    toast.error('Permission denied', {
      description: 'You do not have permission to update properties'
    })
    return
  }
  
  try {
    await updateProperty(id, data)
    toast.success('Property updated')
  } catch (error) {
    toast.error('Failed to update property')
  }
}
```

---

## Page-Level Guards

### Full Page Protection

```typescript
import { usePermissions } from '@/hooks/use-permissions'
import { ShieldAlert } from 'lucide-react'
import { Badge } from '@/components/ui/badge'

export function ReportsPage() {
  const permissions = usePermissions()
  
  // Show loading state
  if (permissions.loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="w-8 h-8 animate-spin" />
      </div>
    )
  }
  
  // Check permission to view the page
  if (!permissions.can('reports', 'read')) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] space-y-4">
        <ShieldAlert className="w-16 h-16 text-destructive" />
        <h2 className="text-2xl font-bold">Access Denied</h2>
        <p className="text-muted-foreground text-center max-w-md">
          You do not have permission to view reports. Please contact your administrator.
        </p>
        <Badge variant="outline">
          Required: Manager, Admin, or Owner role
        </Badge>
      </div>
    )
  }
  
  // Render page content
  return (
    <div className="space-y-6">
      <h1>Reports</h1>
      {/* Page content */}
    </div>
  )
}
```

### Partial Page Restrictions

```typescript
export function DashboardPage() {
  const permissions = usePermissions()
  
  return (
    <div className="space-y-6">
      <h1>Dashboard</h1>
      
      {/* Everyone can see basic stats */}
      <BasicStats />
      
      {/* Only managers and above can see detailed analytics */}
      {permissions.hasHigherOrEqualRole('manager') && (
        <DetailedAnalytics />
      )}
      
      {/* Only admins can see system health */}
      {permissions.isAdmin && (
        <SystemHealth />
      )}
      
      {/* Only owners can see financial data */}
      {permissions.isOwner && (
        <FinancialData />
      )}
    </div>
  )
}
```

---

## Navigation Control

### Dynamic Sidebar

```typescript
import { usePermissions } from '@/hooks/use-permissions'
import { NavLink } from 'react-router-dom'

const navItems = [
  { label: 'Dashboard', to: '/staff/dashboard', minRole: ['staff', 'manager', 'admin', 'owner'] },
  { label: 'Bookings', to: '/staff/bookings', minRole: ['staff', 'manager', 'admin', 'owner'] },
  { label: 'Properties', to: '/staff/properties', minRole: ['manager', 'admin', 'owner'] },
  { label: 'Reports', to: '/staff/reports', minRole: ['manager', 'admin', 'owner'] },
  { label: 'Employees', to: '/staff/employees', minRole: ['admin', 'owner'] },
]

export function Sidebar() {
  const { role } = usePermissions()
  
  // Filter navigation items based on user role
  const visibleItems = navItems.filter(item => 
    role && item.minRole.includes(role)
  )
  
  return (
    <nav>
      {visibleItems.map(item => (
        <NavLink key={item.to} to={item.to}>
          {item.label}
        </NavLink>
      ))}
    </nav>
  )
}
```

### Conditional Menu Items

```typescript
function MoreMenu() {
  const permissions = usePermissions()
  
  return (
    <DropdownMenu>
      <DropdownMenuTrigger>More</DropdownMenuTrigger>
      <DropdownMenuContent>
        {/* Always show */}
        <DropdownMenuItem>View Details</DropdownMenuItem>
        
        {/* Show only if can update */}
        {permissions.can('bookings', 'update') && (
          <DropdownMenuItem>Edit Booking</DropdownMenuItem>
        )}
        
        {/* Show only if can delete */}
        {permissions.can('bookings', 'delete') && (
          <DropdownMenuItem className="text-destructive">
            Delete Booking
          </DropdownMenuItem>
        )}
        
        {/* Show only for managers and above */}
        {permissions.hasHigherOrEqualRole('manager') && (
          <DropdownMenuItem>Advanced Options</DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
```

---

## Common Patterns

### Pattern 1: Conditional Form Fields

```typescript
function EmployeeForm() {
  const permissions = usePermissions()
  
  return (
    <Form>
      <FormField name="name">
        <Input />
      </FormField>
      
      <FormField name="email">
        <Input />
      </FormField>
      
      {/* Only admins and owners can assign roles */}
      {permissions.canManageEmployees && (
        <FormField name="role">
          <Select>
            {/* Show available roles based on user's permission */}
            {permissions.canAssign('staff') && (
              <SelectItem value="staff">Staff</SelectItem>
            )}
            {permissions.canAssign('manager') && (
              <SelectItem value="manager">Manager</SelectItem>
            )}
            {permissions.canAssign('admin') && (
              <SelectItem value="admin">Admin</SelectItem>
            )}
            {permissions.canAssign('owner') && (
              <SelectItem value="owner">Owner</SelectItem>
            )}
          </Select>
        </FormField>
      )}
      
      <Button type="submit">Save</Button>
    </Form>
  )
}
```

### Pattern 2: Conditional Table Actions

```typescript
function BookingsTable() {
  const permissions = usePermissions()
  
  return (
    <Table>
      <TableBody>
        {bookings.map(booking => (
          <TableRow key={booking.id}>
            <TableCell>{booking.guestName}</TableCell>
            <TableCell>{booking.roomNumber}</TableCell>
            <TableCell>
              {/* Actions column */}
              <div className="flex gap-2">
                {/* Everyone can view */}
                <Button size="sm" variant="ghost">
                  View
                </Button>
                
                {/* Only if can update */}
                {permissions.can('bookings', 'update') && (
                  <Button size="sm" variant="outline">
                    Edit
                  </Button>
                )}
                
                {/* Only if can delete */}
                {permissions.can('bookings', 'delete') && (
                  <Button size="sm" variant="destructive">
                    Cancel
                  </Button>
                )}
              </div>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}
```

### Pattern 3: Tiered Features

```typescript
function AnalyticsDashboard() {
  const permissions = usePermissions()
  
  return (
    <div className="grid gap-4">
      {/* Basic stats - everyone */}
      <Card>
        <CardHeader>
          <CardTitle>Today's Bookings</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-3xl font-bold">12</p>
        </CardContent>
      </Card>
      
      {/* Intermediate stats - managers and above */}
      {permissions.hasHigherOrEqualRole('manager') && (
        <Card>
          <CardHeader>
            <CardTitle>Revenue This Month</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold">$45,230</p>
          </CardContent>
        </Card>
      )}
      
      {/* Advanced stats - admins only */}
      {permissions.isAdmin && (
        <Card>
          <CardHeader>
            <CardTitle>Profit Margin</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold">32%</p>
          </CardContent>
        </Card>
      )}
      
      {/* Owner-only stats */}
      {permissions.isOwner && (
        <Card>
          <CardHeader>
            <CardTitle>Year-over-Year Growth</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold">+24%</p>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
```

### Pattern 4: Audit Logging

```typescript
async function handleSensitiveAction(data: any) {
  const permissions = usePermissions()
  const user = await blink.auth.me()
  
  // Check permission
  if (!permissions.can('employees', 'delete')) {
    toast.error('Permission denied')
    return
  }
  
  try {
    // Perform the action
    await deleteEmployee(data.id)
    
    // Log the action for audit trail
    await blink.db.activityLogs.create({
      id: `log_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
      userId: user.id,
      action: 'deleted',
      entityType: 'employee',
      entityId: data.id,
      details: JSON.stringify({
        actorEmail: user.email,
        actorRole: permissions.role,
        employeeName: data.name,
        employeeEmail: data.email,
        employeeRole: data.role,
        timestamp: new Date().toISOString()
      }),
      createdAt: new Date().toISOString()
    })
    
    toast.success('Employee deleted successfully')
  } catch (error) {
    toast.error('Failed to delete employee')
  }
}
```

---

## Best Practices

1. **Always check permissions at multiple levels** - UI, action, and server-side
2. **Provide clear feedback** - Tell users why they can't perform an action
3. **Use the most specific check** - If checking route access, use `canAccess`
4. **Log sensitive actions** - Maintain an audit trail for compliance
5. **Handle loading states** - Check `permissions.loading` before rendering
6. **Use convenience helpers** - `isAdmin`, `canManageEmployees` are clearer than role checks
7. **Fail securely** - Default to denying access if role isn't loaded
8. **Test all roles** - Verify each role sees the correct UI and can perform correct actions

---

## Quick Reference

### usePermissions Hook Methods

```typescript
const permissions = usePermissions()

// Permission checks
permissions.can(resource, action)           // Check specific permission
permissions.canAccess(route)                // Check route access
permissions.canManage(targetRole)           // Check if can manage staff
permissions.canAssign(targetRole)           // Check if can assign role
permissions.hasHigherOrEqualRole(role)      // Compare role levels
permissions.hasHigherRole(role)             // Compare role levels (strict)

// Convenience aliases
permissions.canCreate(resource)
permissions.canRead(resource)
permissions.canUpdate(resource)
permissions.canDelete(resource)

// Multiple checks
permissions.canAll(checks)                  // All must pass
permissions.canAny(checks)                  // At least one must pass

// Role helpers
permissions.role                            // Current role
permissions.isOwner                         // Boolean
permissions.isAdmin                         // Boolean
permissions.isManager                       // Boolean
permissions.isStaff                         // Boolean
permissions.canManageEmployees              // Boolean
permissions.loading                         // Loading state
```

### Permission Component Props

```typescript
<Permission
  resource="employees"                      // Resource to check
  action="delete"                           // Action to check
  route="/staff/employees"                  // Route to check
  role="admin"                              // Exact role required
  minRole="manager"                         // Minimum role required
  targetRole="staff"                        // For management checks
  canManage={true}                          // Check management permission
  canAssign={true}                          // Check assignment permission
  check={() => boolean}                     // Custom check function
  fallback={<div>Access denied</div>}       // Fallback content
>
  <ProtectedContent />
</Permission>
```

---

For more information, see [RBAC_WORKFLOW.md](./RBAC_WORKFLOW.md)

