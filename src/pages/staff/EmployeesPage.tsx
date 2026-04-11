import { useEffect, useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { UserPlus, Search, Loader2, Edit, Trash2, MoreVertical, Copy, Check, Users } from 'lucide-react'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog'
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { supabase } from '@/lib/supabase'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { zodResolver } from '@hookform/resolvers/zod'
import { toast } from '@/hooks/use-toast'
import { useStaffRole } from '@/hooks/use-staff-role'
import { canManageStaff, canAssignRole, getRoleDisplay, getRoleDescription } from '@/lib/rbac'
import type { StaffRole } from '@/lib/rbac'
import { sendStaffWelcomeEmail } from '@/services/email-service'
import { Badge } from '@/components/ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { ActivityLogViewer } from '@/features/history/ActivityLogViewer'

const employeeSchema = z.object({
  name: z.string().min(2, 'Name is too short'),
  email: z.string().email('Enter a valid email'),
  phone: z.string().optional(),
  role: z
    .enum(['staff', 'manager', 'admin', 'owner'])
    .default('staff'),
})

type EmployeeFormValues = z.infer<typeof employeeSchema>

interface StaffMember {
  id: string
  userId: string
  name: string
  email: string
  phone?: string
  role: string
  createdAt: string
}

export function EmployeesPage() {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [employees, setEmployees] = useState<StaffMember[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [editingEmployee, setEditingEmployee] = useState<StaffMember | null>(null)
  const [deletingEmployee, setDeletingEmployee] = useState<StaffMember | null>(null)

  const [passwordDialogOpen, setPasswordDialogOpen] = useState(false)
  const [generatedPassword, setGeneratedPassword] = useState('')
  const [createdEmployeeEmail, setCreatedEmployeeEmail] = useState('')
  const [createdEmployeeName, setCreatedEmployeeName] = useState('')
  const [copied, setCopied] = useState(false)
  const [sendingEmail, setSendingEmail] = useState(false)

  // Use RBAC hook for role management  
  const { role: currentUserRole, canManageEmployees } = useStaffRole()

  console.log('📊 [EmployeesPage] canManageEmployees value:', canManageEmployees, typeof canManageEmployees)

  const form = useForm<EmployeeFormValues>({
    resolver: zodResolver(employeeSchema),
    defaultValues: { name: '', email: '', phone: '', role: 'staff' },
  })

  // Fetch employees on mount
  useEffect(() => {
    loadEmployees()
  }, [])

  const loadEmployees = async () => {
    try {
      console.log('🔄 [EmployeesPage] Loading employees from Supabase...')
      setIsLoading(true)

      const { data: { user } } = await supabase.auth.getUser()
      console.log('👤 [EmployeesPage] Current user:', user?.email)
      if (!user?.id) {
        console.log('❌ [EmployeesPage] No user ID, setting empty employees')
        setEmployees([])
        return
      }

      const { data: staffList, error } = await supabase
        .from('staff')
        .select('*')
        .order('created_at', { ascending: false })

      if (error) {
        console.error('❌ [EmployeesPage] Error loading staff:', error)
        throw error
      }

      // Map snake_case to camelCase
      const mappedStaff: StaffMember[] = (staffList || []).map((s: any) => ({
        id: s.id,
        userId: s.user_id,
        name: s.name,
        email: s.email,
        phone: s.phone,
        role: s.role,
        createdAt: s.created_at,
      }))

      setEmployees(mappedStaff)
      console.log('✅ [EmployeesPage] Employees state updated with', mappedStaff.length, 'employees')
    } catch (err) {
      console.error('❌ [EmployeesPage] Failed to load employees:', err)
      toast({ title: 'Failed to load employees', description: 'Please refresh the page.' })
    } finally {
      setIsLoading(false)
    }
  }

  const handleOpen = () => {
    setEditingEmployee(null)
    setOpen(true)
  }

  const handleClose = () => {
    setOpen(false)
    setEditingEmployee(null)
    form.reset({ name: '', email: '', phone: '', role: 'staff' })
  }

  const handleEdit = (employee: StaffMember) => {
    if (!currentUserRole || !canManageStaff(currentUserRole as StaffRole, employee.role as StaffRole)) {
      toast({
        title: 'Permission denied',
        description: 'You do not have permission to edit this employee.',
        variant: 'destructive',
      })
      return
    }
    setEditingEmployee(employee)
    form.reset({
      name: employee.name,
      email: employee.email,
      phone: employee.phone || '',
      role: employee.role as any,
    })
    setOpen(true)
  }

  const handleDeleteClick = (employee: StaffMember) => {
    if (!currentUserRole || !canManageStaff(currentUserRole as StaffRole, employee.role as StaffRole)) {
      toast({
        title: 'Permission denied',
        description: 'You do not have permission to delete this employee.',
        variant: 'destructive',
      })
      return
    }
    setDeletingEmployee(employee)
  }

  const handleDeleteConfirm = async () => {
    if (!deletingEmployee) return

    const employeeToDelete = deletingEmployee
    const deletedEmployee = { ...employeeToDelete }

    try {
      const { data: { user: currentUser } } = await supabase.auth.getUser()

      console.log('🗑️ [EmployeesPage] Starting cascade delete for employee:', deletedEmployee.name)

      // Track what was deleted for comprehensive logging
      const deletionSummary = {
        staffRecord: false,
        userAccount: false,
        activityLogs: 0,
        bookings: 0,
        otherRecords: 0
      }

      console.log('🗑️ [EmployeesPage] Deleting employee:', deletingEmployee.userId)

      // 1. Delete from Supabase Auth (via Netlify function)
      if (deletingEmployee.userId && deletingEmployee.userId !== 'pending') {
        try {
          console.log('🗑️ [EmployeesPage] Deleting Auth user...')
          await fetch('/.netlify/functions/delete-employee', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId: deletingEmployee.userId })
          })
        } catch (authErr) {
          console.warn('⚠️ [EmployeesPage] Failed to delete Auth user:', authErr)
          // Continue to delete staff record anyway
        }
      }

      // 2. Delete staff record
      const { error: deleteError } = await supabase
        .from('staff')
        .delete()
        .eq('id', deletingEmployee.id)

      if (deleteError) {
        console.error('❌ [EmployeesPage] Staff deletion error:', deleteError)
        throw deleteError
      }

      // 3. Log activity
      try {
        await supabase.from('activity_logs').insert({
          id: `log_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
          user_id: currentUser.id,
          action: 'deleted',
          entity_type: 'employee',
          entity_id: deletingEmployee.id,
          details: JSON.stringify({
            adminEmail: currentUser.email,
            employeeName: deletingEmployee.name,
            employeeEmail: deletingEmployee.email,
            deletedAt: new Date().toISOString()
          }),
          created_at: new Date().toISOString(),
        })
        console.log('   ✅ Cascade deletion logged')
      } catch (logErr) {
        console.error('   ⚠️ Activity logging failed:', logErr)
      }

      console.log('🎉 [EmployeesPage] Cascade delete completed:', deletionSummary)

      // Remove from UI optimistically
      setEmployees((prev) => prev.filter((emp) => emp.id !== deletedEmployee.id))
      setDeletingEmployee(null)

      // Show toast with detailed summary (no undo for cascade delete)
      toast({
        title: 'Employee completely removed',
        description: `${deletedEmployee.name} and all related records have been deleted.`,
      })
    } catch (err: any) {
      console.error('Failed to delete employee:', err)
      toast({
        title: 'Failed to delete employee',
        description: err?.message || 'An error occurred.',
        variant: 'destructive',
      })
    }
  }

  // Send welcome email to new staff
  const handleSendWelcomeEmail = async () => {
    if (!generatedPassword || !createdEmployeeEmail) return

    setSendingEmail(true)
    try {
      const result = await sendStaffWelcomeEmail({
        name: createdEmployeeName,
        email: createdEmployeeEmail,
        tempPassword: generatedPassword,
        role: form.getValues('role'),
        loginUrl: `${window.location.origin}/staff/login`
      })

      if (result.success) {
        toast({
          title: 'Welcome email sent',
          description: `Instructions have been sent to ${createdEmployeeEmail}`
        })
      } else {
        toast({
          title: 'Failed to send email',
          description: result.error || 'Please share credentials manually',
          variant: 'destructive'
        })
      }
    } catch (error: any) {
      toast({
        title: 'Email send failed',
        description: error?.message || 'Please share credentials manually',
        variant: 'destructive'
      })
    } finally {
      setSendingEmail(false)
    }
  }

  const onSubmit = async (values: EmployeeFormValues) => {
    console.log('🚀 [EmployeesPage] Starting employee creation with values:', values)
    try {
      setIsSubmitting(true)

      // Handle editing existing employee
      if (editingEmployee) {
        try {
          const { data: { user: currentUser } } = await supabase.auth.getUser()

          const { error: updateError } = await supabase
            .from('staff')
            .update({
              name: values.name,
              role: values.role,
              phone: values.phone
            })
            .eq('id', editingEmployee.id)

          if (updateError) throw updateError

          // Log activity
          try {
            await supabase.from('activity_logs').insert({
              id: `log_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
              user_id: currentUser?.id,
              action: 'edited',
              entity_type: 'employee',
              entity_id: editingEmployee.id,
              details: JSON.stringify({
                adminEmail: currentUser?.email,
                employeeName: values.name,
                employeeEmail: editingEmployee.email,
                oldRole: editingEmployee.role,
                newRole: values.role,
                changes: {
                  name: editingEmployee.name !== values.name,
                  role: editingEmployee.role !== values.role,
                  phone: editingEmployee.phone !== values.phone
                },
              }),
              created_at: new Date().toISOString(),
            })
          } catch (logErr) {
            console.error('Activity logging failed:', logErr)
          }

          // Update local state optimistically
          setEmployees((prev) =>
            prev.map((emp) =>
              emp.id === editingEmployee.id
                ? { ...emp, name: values.name, role: values.role, phone: values.phone }
                : emp
            )
          )

          toast({
            title: 'Employee updated',
            description: `${values.name} has been updated successfully.`,
          })

          handleClose()
        } catch (err: any) {
          console.error('Failed to update employee:', err)
          toast({
            title: 'Failed to update employee',
            description: err?.message || 'An error occurred.',
            variant: 'destructive',
          })
        }
        return
      }

      // Handle creating new employee
      const { data: { user: currentUser } } = await supabase.auth.getUser()
      if (!currentUser?.id) {
        toast({ title: 'Sign in required', description: 'Please sign in to add employees.' })
        return
      }

      // Optional: quick pre-check if staff email already exists (backend enforces too)
      const { data: existingStaffCheck } = await supabase
        .from('staff')
        .select('id')
        .eq('email', values.email)
        .limit(1)

      if (existingStaffCheck && existingStaffCheck.length > 0) {
        toast({
          title: 'Email already in use',
          description: 'This email is already registered. Please use a different email.',
          variant: 'destructive'
        })
        return
      }

      // Generate optimistic staff ID using proper UUID format (required by Supabase)
      const staffId = crypto.randomUUID()
      const optimisticEmployee: StaffMember = {
        id: staffId,
        userId: 'pending',
        name: values.name,
        email: values.email,
        phone: values.phone,
        role: values.role,
        createdAt: new Date().toISOString(),
      }

      // Add optimistically to UI
      setEmployees((prev) => [optimisticEmployee, ...prev])
      handleClose()

      toast({
        title: 'Creating employee...',
        description: `Adding ${values.name} to the system.`,
      })

      // Create employee using Netlify function for auth and Supabase for staff record
      console.log('📡 [EmployeesPage] Creating employee...')

      try {
        // Use default password that employees must change on first login
        const defaultPassword = 'User@123'

        console.log('👤 [EmployeesPage] Creating user account with Supabase Auth...')

        let newUser: { id: string; email: string } | null = null

        // First, try using the Netlify function (production) - uses Admin API
        try {
          console.log('📡 [EmployeesPage] Calling Netlify function to create auth user...')
          const response = await fetch('/.netlify/functions/create-employee', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              email: values.email,
              password: defaultPassword,
              name: values.name,
              role: values.role,
              phone: values.phone
            })
          })

          console.log('📡 [EmployeesPage] Netlify function response status:', response.status)

          if (response.status === 409) {
            console.warn('❌ [EmployeesPage] User already exists (409)')
            toast({
              title: 'User already exists',
              description: 'An account with this email already exists in the system.',
              variant: 'destructive',
            })
            // Remove optimistic entry
            setEmployees((prev) => prev.filter(e => e.id !== staffId))
            return
          }

          if (response.ok) {
            const result = await response.json()
            console.log('📡 [EmployeesPage] Netlify function result:', result)
            if (result.success && result.user?.id) {
              newUser = result.user
              console.log('✅ [EmployeesPage] User created via Netlify function:', newUser.id)
            } else {
              console.error('❌ [EmployeesPage] Netlify function returned success:false or no user:', result)
            }
          } else {
            const errorResult = await response.text()
            console.error('❌ [EmployeesPage] Netlify function failed with status', response.status, ':', errorResult)
          }
        } catch (netlifyError) {
          console.error('❌ [EmployeesPage] Netlify function error:', netlifyError)
        }

        // Fallback: Use direct Supabase signUp (for local development)
        if (!newUser) {
          console.log('👤 [EmployeesPage] Using direct Supabase signUp...')

          // Import supabase directly for signup
          const { supabase } = await import('@/lib/supabase')

          // Store current session before signing up new user
          const { data: currentSession } = await supabase.auth.getSession()

          const { data, error } = await supabase.auth.signUp({
            email: values.email,
            password: defaultPassword,
            options: {
              data: { name: values.name, role: values.role }
            }
          })

          if (error) {
            console.error('[EmployeesPage] Supabase signUp error:', error)
            throw new Error(error.message)
          }

          if (!data.user) {
            throw new Error('Failed to create user account')
          }

          newUser = { id: data.user.id, email: data.user.email || values.email }
          console.log('✅ [EmployeesPage] User created via Supabase Auth:', newUser.id)

          // Restore admin session if it was cleared
          if (currentSession?.session) {
            await supabase.auth.setSession({
              access_token: currentSession.session.access_token,
              refresh_token: currentSession.session.refresh_token
            })
            console.log('✅ [EmployeesPage] Admin session restored')
          }

          // Create user profile record
          try {
            await supabase.from('users').insert({
              id: data.user.id,
              email: data.user.email,
              first_login: 1,
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString()
            })
          } catch (profileError) {
            console.warn('⚠️ [EmployeesPage] Could not create user profile:', profileError)
          }
        }

        if (!newUser?.id) {
          throw new Error('Failed to create user account')
        }

        console.log('✅ [EmployeesPage] User account created:', newUser.id)

        // Set first login flag to force password change
        try {
          await supabase.from('users').update({
            first_login: 1
          }).eq('id', newUser.id)
          console.log('✅ [EmployeesPage] First login flag set')
        } catch (flagError) {
          console.warn('⚠️ [EmployeesPage] Could not set first login flag:', flagError)
          // Don't fail the entire operation, but log the warning
        }

        // Create staff record
        console.log('👥 [EmployeesPage] Creating staff record...')
        const { data: newStaff, error: staffError } = await supabase
          .from('staff')
          .insert({
            id: staffId,
            user_id: newUser.id,
            name: values.name,
            email: values.email,
            phone: values.phone || null,
            role: values.role,
            created_at: new Date().toISOString(),
          })
          .select()
          .single()

        if (staffError) {
          console.error('❌ [EmployeesPage] Staff record creation error:', staffError)
          throw staffError
        }

        console.log('✅ [EmployeesPage] Staff record created:', newStaff)

        // Log employee creation to activity logs
        try {
          await supabase.from('activity_logs').insert({
            id: `log_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
            user_id: currentUser.id,
            action: 'created',
            entity_type: 'employee',
            entity_id: staffId,
            details: JSON.stringify({
              adminEmail: currentUser.email,
              employeeName: values.name,
              employeeEmail: values.email,
              role: values.role,
              createdAt: new Date().toISOString()
            }),
            created_at: new Date().toISOString(),
          })
          console.log('✅ [EmployeesPage] Employee creation logged to activity logs')
        } catch (logErr) {
          console.error('⚠️ [EmployeesPage] Activity logging failed:', logErr)
        }

        // Update optimistic entry with real userId
        setEmployees((prev) => prev.map((emp) => (emp.id === staffId ? { ...emp, userId: newUser.id } : emp)))

        // Automatically send welcome email with default credentials
        console.log('📧 [EmployeesPage] Sending welcome email automatically...')
        try {
          const emailResult = await sendStaffWelcomeEmail({
            name: values.name,
            email: values.email,
            tempPassword: defaultPassword,
            role: getRoleDisplay(values.role as StaffRole),
            loginUrl: `${window.location.origin}/staff/login`
          })

          if (emailResult.success) {
            console.log('✅ [EmployeesPage] Welcome email sent successfully')
            toast({
              title: 'Welcome email sent!',
              description: `Login credentials sent to ${values.email}`,
            })
          } else {
            console.warn('⚠️ [EmployeesPage] Email send failed:', emailResult.error)
            toast({
              title: 'Employee created, but email failed',
              description: 'You can manually share the credentials below',
              variant: 'destructive'
            })
          }
        } catch (emailError: any) {
          console.error('❌ [EmployeesPage] Email send error:', emailError)
          toast({
            title: 'Email send failed',
            description: 'Please manually share credentials with the employee',
            variant: 'destructive'
          })
        }

        // Show password dialog with credentials
        setGeneratedPassword(defaultPassword)
        setCreatedEmployeeEmail(values.email)
        setCreatedEmployeeName(values.name)
        setPasswordDialogOpen(true)

        console.log('✅ [EmployeesPage] Employee creation completed successfully')

        // Show immediate success notification
        toast({
          title: 'Employee created!',
          description: `${values.name} has been added. Refreshing list...`,
        })

      } catch (createError: any) {
        console.error('❌ [EmployeesPage] Employee creation failed:', createError)
        console.error('❌ [EmployeesPage] Error details:', {
          message: createError.message,
          status: createError.status,
          code: createError.code,
          details: createError.details,
          stack: createError.stack
        })

        // Remove optimistic entry
        setEmployees((prev) => prev.filter((emp) => emp.id !== staffId))

        // Handle specific error cases
        if (createError.message?.includes('already exists') ||
          createError.message?.includes('already registered') ||
          createError.message?.includes('duplicate') ||
          createError.status === 409) {
          toast({
            title: 'Email already in use',
            description: 'This email is already registered. Please use a different email.',
            variant: 'destructive',
          })
        } else if (createError.message?.includes('rate limit') ||
          createError.message?.includes('too many requests') ||
          createError.status === 429) {
          toast({
            title: 'Rate limit exceeded',
            description: 'Please wait a moment before adding another employee.',
            variant: 'destructive',
          })
        } else if (createError.message?.includes('constraint') ||
          createError.message?.includes('unique')) {
          toast({
            title: 'Database constraint error',
            description: 'There was a conflict with existing data. Please try again.',
            variant: 'destructive',
          })
        } else {
          toast({
            title: 'Failed to create employee',
            description: createError.message || 'An unexpected error occurred. Please try again.',
            variant: 'destructive',
          })
        }
        return
      }

      // Refresh list to ensure full consistency with delay
      console.log('🔄 [EmployeesPage] Refreshing employee list...')

      // Add delay to ensure database consistency
      await new Promise(resolve => setTimeout(resolve, 2000))

      try {
        await loadEmployees()
        console.log('✅ [EmployeesPage] Employee list refreshed successfully')

        // Verify the new employee is in the list
        const { data: updatedList } = await supabase
          .from('staff')
          .select('*')
          .order('created_at', { ascending: false })

        const newEmployeeInList = updatedList?.find(emp => emp.email === values.email)

        if (newEmployeeInList) {
          console.log('✅ [EmployeesPage] New employee confirmed in database:', newEmployeeInList)
        } else {
          console.warn('⚠️ [EmployeesPage] New employee not found in refreshed list')
        }
      } catch (refreshError) {
        console.error('❌ [EmployeesPage] Error refreshing list:', refreshError)
        // Don't fail the entire operation if refresh fails
      }

      toast({
        title: 'Employee added successfully',
        description: `${values.name} has been added to the system.`
      })

    } catch (err: any) {
      console.error('❌ Employee creation error:', err)
      toast({
        title: 'Failed to add employee',
        description: err?.message || 'An unexpected error occurred. Please try again.',
        variant: 'destructive'
      })
    } finally {
      setIsSubmitting(false)
    }
  }

  // Filter employees based on search query
  const filteredEmployees = useMemo(() => {
    if (!query.trim()) return employees
    const lowerQuery = query.toLowerCase()
    return employees.filter(
      (emp) =>
        emp.name.toLowerCase().includes(lowerQuery) ||
        emp.email.toLowerCase().includes(lowerQuery) ||
        (emp.phone && emp.phone.includes(lowerQuery))
    )
  }, [employees, query])

  // Get available roles for assignment based on current user role
  const getAvailableRoles = (): StaffRole[] => {
    if (!currentUserRole) return []
    if (currentUserRole === 'owner') return ['staff', 'manager', 'admin', 'owner']
    if (currentUserRole === 'admin') return ['staff', 'manager', 'admin']
    return []
  }

  // Check if current user can edit an employee
  const canEditEmployee = (employee: StaffMember): boolean => {
    if (!currentUserRole) return false
    if (currentUserRole === 'owner') return true
    // Admin can edit anyone except owner
    if (currentUserRole === 'admin' && employee.role !== 'owner') return true
    return false
  }

  // Check if current user can delete an employee
  const canDeleteEmployee = (employee: StaffMember): boolean => {
    if (!currentUserRole) return false
    if (currentUserRole === 'owner') return true
    // Admin can delete anyone except owner
    if (currentUserRole === 'admin' && employee.role !== 'owner') return true
    return false
  }

  // Role badge variant
  const getRoleBadgeVariant = (role: string): 'default' | 'secondary' | 'outline' => {
    if (role === 'owner' || role === 'admin') return 'default'
    if (role === 'manager') return 'secondary'
    return 'outline'
  }

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <div className="p-1.5 rounded-lg bg-primary/10">
              <Users className="w-5 h-5 text-primary" />
            </div>
            <h1 className="text-2xl font-bold tracking-tight">Employees</h1>
          </div>
          <p className="text-sm text-muted-foreground">Manage staff members and permissions &mdash; {employees.length} total</p>
        </div>
        <div className="flex gap-2">
          <Button onClick={loadEmployees} variant="outline" disabled={isLoading}>
            <Loader2 className={`w-4 h-4 mr-2 ${isLoading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
          {canManageEmployees && (
            <Button onClick={handleOpen} className="shadow-sm">
              <UserPlus className="w-4 h-4 mr-2" />
              Add employee
            </Button>
          )}
        </div>
      </div>

      <Tabs defaultValue="data" className="w-full">
        <TabsList>
          <TabsTrigger value="data">Data</TabsTrigger>
          <TabsTrigger value="permissions">Permissions</TabsTrigger>
          <TabsTrigger value="activity">Activity Log</TabsTrigger>
        </TabsList>
        <TabsContent value="data" className="space-y-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Search employees by name or email..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="pl-9"
            />
          </div>
          <Card>
            {isLoading ? (
              <CardContent className="py-16 text-center text-muted-foreground">
                <Loader2 className="w-6 h-6 animate-spin mx-auto mb-2" />
                Loading employees...
              </CardContent>
            ) : filteredEmployees.length === 0 ? (
              <CardContent className="py-16 text-center text-muted-foreground">
                {query ? 'No employees match your search.' : 'No employees yet. Click "Add employee" to create one.'}
              </CardContent>
            ) : (
              <CardContent className="p-0">
                <div className="overflow-x-auto"><Table>
                  <TableHeader>
                    <TableRow className="bg-muted/50 hover:bg-muted/50">
                      <TableHead className="text-xs font-semibold uppercase tracking-wider text-muted-foreground py-3">Name</TableHead>
                      <TableHead className="text-xs font-semibold uppercase tracking-wider text-muted-foreground py-3">Email</TableHead>
                      <TableHead className="text-xs font-semibold uppercase tracking-wider text-muted-foreground py-3">Role</TableHead>
                      <TableHead className="text-xs font-semibold uppercase tracking-wider text-muted-foreground py-3">Created</TableHead>
                      {canManageEmployees && <TableHead className="text-xs font-semibold uppercase tracking-wider text-muted-foreground py-3 text-right">Actions</TableHead>}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredEmployees.map((employee) => (
                      <TableRow key={employee.id}>
                        <TableCell className="font-medium">{employee.name}</TableCell>
                        <TableCell>{employee.email}</TableCell>
                        <TableCell>
                          {(employee.role === 'owner' || employee.role === 'admin') ? (
                            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-primary/10 text-primary ring-1 ring-primary/20">
                              {getRoleDisplay(employee.role)}
                            </span>
                          ) : employee.role === 'manager' ? (
                            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-blue-50 text-blue-700 ring-1 ring-blue-200">
                              {getRoleDisplay(employee.role)}
                            </span>
                          ) : (
                            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-muted text-muted-foreground ring-1 ring-border">
                              {getRoleDisplay(employee.role)}
                            </span>
                          )}
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {new Date(employee.createdAt).toLocaleDateString()}
                        </TableCell>
                        {canManageEmployees && (
                          <TableCell className="text-right">
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button variant="ghost" size="sm">
                                  <MoreVertical className="w-4 h-4" />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end">
                                {canEditEmployee(employee) && (
                                  <DropdownMenuItem onClick={() => handleEdit(employee)}>
                                    <Edit className="w-4 h-4 mr-2" />
                                    Edit
                                  </DropdownMenuItem>
                                )}
                                {canDeleteEmployee(employee) && (
                                  <DropdownMenuItem
                                    onClick={() => handleDeleteClick(employee)}
                                    className="text-destructive focus:text-destructive"
                                  >
                                    <Trash2 className="w-4 h-4 mr-2" />
                                    Delete
                                  </DropdownMenuItem>
                                )}
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </TableCell>
                        )}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table></div>
              </CardContent>
            )}
          </Card>
        </TabsContent>
        <TabsContent value="permissions" className="space-y-4">
          <Card>
            <CardContent className="p-6">
              <div className="space-y-6">
                <div>
                  <h3 className="text-lg font-semibold mb-2">Role Permissions Overview</h3>
                  <p className="text-sm text-muted-foreground">
                    This table shows what each role can do in the system. Permissions are organized by resource type.
                  </p>
                </div>

                {/* Permissions Matrix */}
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-muted/50 hover:bg-muted/50">
                        <TableHead className="text-xs font-semibold uppercase tracking-wider text-muted-foreground py-3 w-[200px]">Resource</TableHead>
                        <TableHead className="text-xs font-semibold uppercase tracking-wider text-muted-foreground py-3 text-center">Staff</TableHead>
                        <TableHead className="text-xs font-semibold uppercase tracking-wider text-muted-foreground py-3 text-center">Manager</TableHead>
                        <TableHead className="text-xs font-semibold uppercase tracking-wider text-muted-foreground py-3 text-center">Admin</TableHead>
                        <TableHead className="text-xs font-semibold uppercase tracking-wider text-muted-foreground py-3 text-center">Owner</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {/* Employees */}
                      <TableRow>
                        <TableCell className="font-medium">Employees</TableCell>
                        <TableCell className="text-center">
                          <Badge variant="outline" className="text-muted-foreground">No access</Badge>
                        </TableCell>
                        <TableCell className="text-center">
                          <Badge variant="outline" className="text-muted-foreground">No access</Badge>
                        </TableCell>
                        <TableCell className="text-center">
                          <div className="flex flex-col gap-1">
                            <Badge variant="default" className="text-xs">Create</Badge>
                            <Badge variant="default" className="text-xs">Read</Badge>
                            <Badge variant="default" className="text-xs">Update</Badge>
                            <Badge variant="default" className="text-xs">Delete</Badge>
                          </div>
                        </TableCell>
                        <TableCell className="text-center">
                          <Badge variant="default" className="bg-green-600 hover:bg-green-700">Full Access</Badge>
                        </TableCell>
                      </TableRow>

                      {/* Bookings */}
                      <TableRow>
                        <TableCell className="font-medium">Bookings</TableCell>
                        <TableCell className="text-center">
                          <div className="flex flex-col gap-1">
                            <Badge variant="secondary" className="text-xs">Create</Badge>
                            <Badge variant="secondary" className="text-xs">Read</Badge>
                            <Badge variant="secondary" className="text-xs">Update</Badge>
                          </div>
                        </TableCell>
                        <TableCell className="text-center">
                          <Badge variant="default" className="bg-blue-600 hover:bg-blue-700 text-xs">Full CRUD</Badge>
                        </TableCell>
                        <TableCell className="text-center">
                          <Badge variant="default" className="bg-blue-600 hover:bg-blue-700 text-xs">Full CRUD</Badge>
                        </TableCell>
                        <TableCell className="text-center">
                          <Badge variant="default" className="bg-green-600 hover:bg-green-700">Full Access</Badge>
                        </TableCell>
                      </TableRow>

                      {/* Properties */}
                      <TableRow>
                        <TableCell className="font-medium">Properties</TableCell>
                        <TableCell className="text-center">
                          <Badge variant="outline" className="text-muted-foreground">No access</Badge>
                        </TableCell>
                        <TableCell className="text-center">
                          <div className="flex flex-col gap-1">
                            <Badge variant="secondary" className="text-xs">Create</Badge>
                            <Badge variant="secondary" className="text-xs">Read</Badge>
                            <Badge variant="secondary" className="text-xs">Update</Badge>
                          </div>
                        </TableCell>
                        <TableCell className="text-center">
                          <Badge variant="default" className="bg-blue-600 hover:bg-blue-700 text-xs">Full CRUD</Badge>
                        </TableCell>
                        <TableCell className="text-center">
                          <Badge variant="default" className="bg-green-600 hover:bg-green-700">Full Access</Badge>
                        </TableCell>
                      </TableRow>

                      {/* Guests */}
                      <TableRow>
                        <TableCell className="font-medium">Guests</TableCell>
                        <TableCell className="text-center">
                          <div className="flex flex-col gap-1">
                            <Badge variant="secondary" className="text-xs">Read</Badge>
                            <Badge variant="secondary" className="text-xs">Update</Badge>
                          </div>
                        </TableCell>
                        <TableCell className="text-center">
                          <div className="flex flex-col gap-1">
                            <Badge variant="secondary" className="text-xs">Create</Badge>
                            <Badge variant="secondary" className="text-xs">Read</Badge>
                            <Badge variant="secondary" className="text-xs">Update</Badge>
                          </div>
                        </TableCell>
                        <TableCell className="text-center">
                          <Badge variant="default" className="bg-blue-600 hover:bg-blue-700 text-xs">Full CRUD</Badge>
                        </TableCell>
                        <TableCell className="text-center">
                          <Badge variant="default" className="bg-green-600 hover:bg-green-700">Full Access</Badge>
                        </TableCell>
                      </TableRow>

                      {/* Reports */}
                      <TableRow>
                        <TableCell className="font-medium">Reports</TableCell>
                        <TableCell className="text-center">
                          <Badge variant="outline" className="text-muted-foreground">No access</Badge>
                        </TableCell>
                        <TableCell className="text-center">
                          <Badge variant="secondary" className="text-xs">Read</Badge>
                        </TableCell>
                        <TableCell className="text-center">
                          <Badge variant="secondary" className="text-xs">Read</Badge>
                        </TableCell>
                        <TableCell className="text-center">
                          <Badge variant="default" className="bg-green-600 hover:bg-green-700">Full Access</Badge>
                        </TableCell>
                      </TableRow>

                      {/* Invoices */}
                      <TableRow>
                        <TableCell className="font-medium">Invoices</TableCell>
                        <TableCell className="text-center">
                          <Badge variant="outline" className="text-muted-foreground">No access</Badge>
                        </TableCell>
                        <TableCell className="text-center">
                          <Badge variant="outline" className="text-muted-foreground">No access</Badge>
                        </TableCell>
                        <TableCell className="text-center">
                          <Badge variant="default" className="bg-blue-600 hover:bg-blue-700 text-xs">Full CRUD</Badge>
                        </TableCell>
                        <TableCell className="text-center">
                          <Badge variant="default" className="bg-green-600 hover:bg-green-700">Full Access</Badge>
                        </TableCell>
                      </TableRow>

                      {/* Housekeeping */}
                      <TableRow>
                        <TableCell className="font-medium">Housekeeping</TableCell>
                        <TableCell className="text-center">
                          <div className="flex flex-col gap-1">
                            <Badge variant="secondary" className="text-xs">Read</Badge>
                            <Badge variant="secondary" className="text-xs">Update</Badge>
                          </div>
                        </TableCell>
                        <TableCell className="text-center">
                          <div className="flex flex-col gap-1">
                            <Badge variant="secondary" className="text-xs">Read</Badge>
                            <Badge variant="secondary" className="text-xs">Update</Badge>
                          </div>
                        </TableCell>
                        <TableCell className="text-center">
                          <div className="flex flex-col gap-1">
                            <Badge variant="secondary" className="text-xs">Read</Badge>
                            <Badge variant="secondary" className="text-xs">Update</Badge>
                          </div>
                        </TableCell>
                        <TableCell className="text-center">
                          <Badge variant="default" className="bg-green-600 hover:bg-green-700">Full Access</Badge>
                        </TableCell>
                      </TableRow>

                      {/* Settings */}
                      <TableRow>
                        <TableCell className="font-medium">Settings</TableCell>
                        <TableCell className="text-center">
                          <Badge variant="outline" className="text-muted-foreground">No access</Badge>
                        </TableCell>
                        <TableCell className="text-center">
                          <Badge variant="outline" className="text-muted-foreground">No access</Badge>
                        </TableCell>
                        <TableCell className="text-center">
                          <div className="flex flex-col gap-1">
                            <Badge variant="secondary" className="text-xs">Read</Badge>
                            <Badge variant="secondary" className="text-xs">Update</Badge>
                          </div>
                        </TableCell>
                        <TableCell className="text-center">
                          <Badge variant="default" className="bg-green-600 hover:bg-green-700">Full Access</Badge>
                        </TableCell>
                      </TableRow>
                    </TableBody>
                  </Table>
                </div>

                {/* Role Descriptions */}
                <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4 mt-8">
                  <div className="p-4 border rounded-lg space-y-2">
                    <div className="flex items-center gap-2">
                      <Badge variant="outline">Staff</Badge>
                      <span className="text-xs text-muted-foreground">Level 1</span>
                    </div>
                    <p className="text-sm text-muted-foreground">
                      Basic operations - bookings, guests, housekeeping. Cannot delete records or access financial data.
                    </p>
                  </div>

                  <div className="p-4 border rounded-lg space-y-2">
                    <div className="flex items-center gap-2">
                      <Badge variant="secondary">Manager</Badge>
                      <span className="text-xs text-muted-foreground">Level 2</span>
                    </div>
                    <p className="text-sm text-muted-foreground">
                      Supervisory operations - all staff features plus property management and reports.
                    </p>
                  </div>

                  <div className="p-4 border rounded-lg space-y-2">
                    <div className="flex items-center gap-2">
                      <Badge variant="default">Admin</Badge>
                      <span className="text-xs text-muted-foreground">Level 3</span>
                    </div>
                    <p className="text-sm text-muted-foreground">
                      Full operational control - manage employees, invoices, and system settings. Cannot manage owners.
                    </p>
                  </div>

                  <div className="p-4 border rounded-lg space-y-2">
                    <div className="flex items-center gap-2">
                      <Badge variant="default" className="bg-green-600 hover:bg-green-700">Owner</Badge>
                      <span className="text-xs text-muted-foreground">Level 4</span>
                    </div>
                    <p className="text-sm text-muted-foreground">
                      Complete system access - manage all employees including admins, full system configuration.
                    </p>
                  </div>
                </div>

                {/* Role Management Rules */}
                <div className="mt-8 p-4 bg-blue-50 dark:bg-blue-950 border border-blue-200 dark:border-blue-800 rounded-lg">
                  <h4 className="font-semibold mb-3 text-blue-900 dark:text-blue-100">Role Management Rules</h4>
                  <ul className="space-y-2 text-sm text-blue-800 dark:text-blue-200">
                    <li className="flex items-start gap-2">
                      <span className="text-blue-600 dark:text-blue-400 mt-0.5">•</span>
                      <span><strong>Owners</strong> can manage all employees and assign any role including owner</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <span className="text-blue-600 dark:text-blue-400 mt-0.5">•</span>
                      <span><strong>Admins</strong> can manage staff, managers, and other admins, but cannot manage owners</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <span className="text-blue-600 dark:text-blue-400 mt-0.5">•</span>
                      <span><strong>Admins</strong> can assign roles up to admin level (cannot assign owner role)</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <span className="text-blue-600 dark:text-blue-400 mt-0.5">•</span>
                      <span><strong>Managers and Staff</strong> cannot manage other employees</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <span className="text-blue-600 dark:text-blue-400 mt-0.5">•</span>
                      <span>All sensitive actions are logged in the activity history for audit purposes</span>
                    </li>
                  </ul>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
        <TabsContent value="activity">
          <ActivityLogViewer
            entityType="employee"
            showFilters={true}
            limit={100}
          />
        </TabsContent>
      </Tabs>

      <Dialog open={open} onOpenChange={(v) => (v ? setOpen(true) : handleClose())}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingEmployee ? 'Edit employee' : 'Add employee'}</DialogTitle>
            <DialogDescription>
              {editingEmployee
                ? 'Update the employee details below.'
                : 'Enter details for the new team member.'}
            </DialogDescription>
          </DialogHeader>

          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Full name</FormLabel>
                    <FormControl>
                      <Input placeholder="Jane Doe" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="email"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Email</FormLabel>
                    <FormControl>
                      <Input type="email" placeholder="jane@example.com" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="phone"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Phone (Optional)</FormLabel>
                    <FormControl>
                      <Input placeholder="+233..." {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="role"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Role</FormLabel>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Select role" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {getAvailableRoles().map(role => (
                          <SelectItem key={role} value={role}>
                            {getRoleDisplay(role as StaffRole)} - {getRoleDescription(role as StaffRole)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <DialogFooter>
                <Button type="button" variant="outline" onClick={handleClose} disabled={isSubmitting}>
                  Cancel
                </Button>
                <Button type="submit" disabled={isSubmitting}>
                  {isSubmitting ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      {editingEmployee ? 'Updating…' : 'Creating…'}
                    </>
                  ) : (
                    editingEmployee ? 'Update employee' : 'Create employee'
                  )}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deletingEmployee} onOpenChange={(open) => !open && setDeletingEmployee(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete employee and all related data</AlertDialogTitle>
            <AlertDialogDescription className="space-y-3">
              <p>
                Are you sure you want to delete <strong>{deletingEmployee?.name}</strong>?
              </p>
              <div className="rounded-lg bg-amber-50 border border-amber-200 p-3 text-sm">
                <p className="font-semibold text-amber-900 mb-2">⚠️ This will permanently delete:</p>
                <ul className="text-amber-800 space-y-1 ml-4 list-disc">
                  <li>Staff record</li>
                  <li>User authentication account</li>
                  <li>Activity logs created by this employee</li>
                  <li>Employee references in bookings (anonymized)</li>
                </ul>
              </div>
              <p className="text-destructive font-medium">
                This action cannot be undone.
              </p>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteConfirm} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Delete Everything
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={passwordDialogOpen} onOpenChange={setPasswordDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Employee Created Successfully! ✅</DialogTitle>
            <DialogDescription>
              <span className="font-medium">{createdEmployeeName}</span> has been added to the system.
              A welcome email with login credentials has been automatically sent to{' '}
              <span className="font-medium">{createdEmployeeEmail}</span>.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="rounded-lg bg-green-50 border border-green-200 p-4">
              <p className="text-sm font-medium text-green-900 mb-2">✉️ Email Sent</p>
              <p className="text-sm text-green-700">
                Login instructions have been sent to the employee's email address.
              </p>
            </div>

            <div className="rounded-lg bg-secondary p-4 space-y-3">
              <p className="text-sm font-medium">Default Login Credentials:</p>
              <div className="space-y-2">
                <div>
                  <div className="text-xs text-muted-foreground uppercase tracking-wide mb-1">Email</div>
                  <div className="flex items-center gap-2">
                    <code className="text-sm font-mono bg-background px-3 py-2 rounded flex-1">{createdEmployeeEmail}</code>
                  </div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground uppercase tracking-wide mb-1">Default Password</div>
                  <div className="flex items-center gap-2">
                    <code className="text-sm font-mono bg-background px-3 py-2 rounded flex-1">{generatedPassword || 'staff@123'}</code>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={async () => {
                        if (!generatedPassword) return
                        try {
                          await navigator.clipboard.writeText(generatedPassword)
                          setCopied(true)
                          setTimeout(() => setCopied(false), 1500)
                        } catch (e) {
                          console.debug('Clipboard copy failed', e)
                        }
                      }}
                    >
                      {copied ? <Check className="w-4 h-4 mr-1" /> : <Copy className="w-4 h-4 mr-1" />}
                      {copied ? 'Copied' : 'Copy'}
                    </Button>
                  </div>
                </div>
              </div>
            </div>

            <div className="flex items-start gap-2 p-3 bg-amber-50 border border-amber-200 rounded-md text-sm">
              <div className="text-amber-600 mt-0.5">⚠️</div>
              <p className="text-amber-900 flex-1">
                <strong>Important:</strong> The employee will be required to change this password on their first login for security purposes.
              </p>
            </div>
          </div>

          <DialogFooter className="flex-col sm:flex-row gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={handleSendWelcomeEmail}
              disabled={sendingEmail}
              className="w-full sm:w-auto"
            >
              {sendingEmail ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Resending...
                </>
              ) : (
                <>
                  <Copy className="w-4 h-4 mr-2" />
                  Resend Email
                </>
              )}
            </Button>
            <Button onClick={() => setPasswordDialogOpen(false)} className="w-full sm:w-auto">
              Done
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

    </div>
  )
}

export default EmployeesPage