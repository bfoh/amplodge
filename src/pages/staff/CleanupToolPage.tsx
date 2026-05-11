import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { AlertTriangle, Trash2, Shield, CheckCircle2, Loader2, RefreshCw } from 'lucide-react'
import { db, auth } from '@/lib/db'
import { toast } from '@/hooks/use-toast'
import { useStaffRole } from '@/hooks/use-staff-role'

interface StaffMember {
  id: string
  userId: string
  name: string
  email: string
  role: string
  createdAt: string
}

export function CleanupToolPage() {
  const { role, canManageEmployees } = useStaffRole()
  const [scanning, setScanning] = useState(false)
  const [cleaning, setCleaning] = useState(false)
  const [staffToDelete, setStaffToDelete] = useState<StaffMember[]>([])
  const [staffToKeep, setStaffToKeep] = useState<StaffMember[]>([])
  const [scanned, setScanned] = useState(false)
  const [cleaned, setCleaned] = useState(false)
  const [deletedCount, setDeletedCount] = useState(0)
  const [cleaningTasks, setCleaningTasks] = useState(false)
  const [cleaningGuests, setCleaningGuests] = useState(false)
  const [cleaningMockData, setCleaningMockData] = useState(false)
  const [resettingRooms, setResettingRooms] = useState(false)
  const [deduplicatingBookings, setDeduplicatingBookings] = useState(false)

  const clearGuests = async () => {
    if (!confirm('Are you sure you want to delete ALL guest records? This may affect booking history.')) return

    setCleaningGuests(true)
    try {
      console.log('🗑️ Deleting guests...')
      let deleted = 0
      let hasMore = true

      while (hasMore) {
        const guests = await (db as any).guests.list({ limit: 100 })
        if (guests.length === 0) {
          hasMore = false
          break
        }

        for (const guest of guests) {
          await (db as any).guests.delete(guest.id)
          deleted++
        }
      }

      toast({
        title: 'Guest database cleared',
        description: `Deleted ${deleted} guest records`,
      })
    } catch (error: any) {
      console.error('Failed to clear guests:', error)
      toast({ title: 'Failed to clear guests', description: error.message, variant: 'destructive' })
    } finally {
      setCleaningGuests(false)
    }
  }

  const resetRoomStatuses = async () => {
    if (!confirm('Reset ALL properties to active?')) return

    setResettingRooms(true)
    try {
      console.log('🛏️ Resetting property statuses...')
      let propertiesUpdated = 0
      try {
        const properties = await db.properties.list({ limit: 1000 })
        for (const property of properties) {
          if (property.status && property.status !== 'active') {
            await db.properties.update(property.id, { status: 'active' })
            propertiesUpdated++
          }
        }
      } catch (propErr) {
        console.warn('Failed to reset property statuses:', propErr)
      }

      toast({
        title: 'Property statuses reset',
        description: `Properties reactivated: ${propertiesUpdated}`
      })
    } catch (error: any) {
      console.error('Failed to reset room statuses:', error)
      toast({ title: 'Failed to reset room statuses', description: error.message, variant: 'destructive' })
    } finally {
      setResettingRooms(false)
    }
  }

  const clearHousekeepingTasks = async () => {
    if (!confirm('Are you sure you want to delete ALL housekeeping tasks?')) return

    setCleaningTasks(true)
    try {
      console.log('🗑️ Deleting housekeeping tasks...')
      let deletedTotal = 0
      let hasMore = true

      while (hasMore) {
        const tasks = await (db as any).housekeepingTasks.list({ limit: 100 })
        if (tasks.length === 0) {
          hasMore = false
          break
        }

        for (const task of tasks) {
          await (db as any).housekeepingTasks.delete(task.id)
          deletedTotal++
        }
        console.log(`Deleted batch of ${tasks.length} tasks...`)
      }

      toast({
        title: 'Housekeeping tasks cleared',
        description: `Deleted ${deletedTotal} tasks`,
      })
    } catch (error: any) {
      console.error('Failed to clear tasks:', error)
      toast({ title: 'Failed to clear tasks', description: error.message, variant: 'destructive' })
    } finally {
      setCleaningTasks(false)
    }
  }

  const clearMockData = async () => {
    if (!confirm('Are you sure you want to delete ALL mock data (bookings, guests, invoices, logs)? This effectively resets the app.')) return

    setCleaningMockData(true)
    try {
      console.log('🗑️ Deleting mock data...')

      // Helper for batched deletion
      const deleteCollection = async (collectionName: string, label: string) => {
        let deleted = 0
        let hasMore = true
        while (hasMore) {
          // Dynamic access to collection
          const collection = (db as any)[collectionName]
          if (!collection) break

          const items = await collection.list({ limit: 100 })
          if (items.length === 0) {
            hasMore = false
            break
          }

          for (const item of items) {
            await collection.delete(item.id)
            deleted++
          }
        }
        console.log(`Deleted ${deleted} ${label}`)
        return deleted
      }

      // 1. Delete Bookings
      await deleteCollection('bookings', 'bookings')

      // 2. Delete Guests
      await deleteCollection('guests', 'guests')

      // 3. Delete Invoices
      try {
        await deleteCollection('invoices', 'invoices')
      } catch (e) { console.log('No invoices table or empty') }

      // 4. Reset Property Status (Update, not delete)
      console.log('Resetting property statuses...')
      let propertiesUpdated = 0
      const properties = await (db as any).properties.list({ limit: 1000 })
      for (const p of properties) {
        await (db as any).properties.update(p.id, { status: 'active' })
        propertiesUpdated++
      }
      console.log(`Reset ${propertiesUpdated} properties to active`)

      // 5. Clear Activity Logs
      await deleteCollection('activityLogs', 'logs')

      // 6. Clear Housekeeping Tasks
      await deleteCollection('housekeepingTasks', 'tasks')

      // 7. Clear Contact Messages
      await deleteCollection('contactMessages', 'contact messages')

      toast({
        title: 'Mock data cleared',
        description: 'App has been reset to a clean state (rooms available, no bookings).',
      })
    } catch (error: any) {
      console.error('Failed to clear mock data:', error)
      toast({ title: 'Failed to clear data', description: error.message, variant: 'destructive' })
    } finally {
      setCleaningMockData(false)
    }
  }

  const deduplicateBookings = async () => {
    if (!confirm('Scan for and remove duplicate bookings? This will keep one copy of each reservation based on guest, room, and dates.')) return

    setDeduplicatingBookings(true)
    try {
      console.log('🔍 Deduplicating bookings...')
      const allBookings = await (db as any).bookings.list({ limit: 5000 })
      const groups: Record<string, any[]> = {}
      
      // Group by logical identity
      allBookings.forEach((b: any) => {
        if (!['reserved', 'confirmed', 'checked-in'].includes(b.status)) return
        
        const key = `${b.guest_id || b.guestId}_${b.room_id || b.roomId}_${b.check_in || b.dates?.checkIn}_${b.check_out || b.dates?.checkOut}`
        if (!groups[key]) groups[key] = []
        groups[key].push(b)
      })

      let deleted = 0
      for (const key in groups) {
        const matches = groups[key]
        if (matches.length > 1) {
          // Keep the first one, delete the rest
          // Sort to prefer ones with client_request_id or more recent created_at
          matches.sort((a, b) => {
            if (a.client_request_id && !b.client_request_id) return -1
            if (!a.client_request_id && b.client_request_id) return 1
            return new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime()
          })

          const toDelete = matches.slice(1)
          for (const b of toDelete) {
            await (db as any).bookings.delete(b.id)
            deleted++
          }
        }
      }

      toast({
        title: 'Deduplication complete',
        description: `Removed ${deleted} duplicate bookings`,
      })
    } catch (error: any) {
      console.error('Failed to deduplicate bookings:', error)
      toast({ title: 'Deduplication failed', description: error.message, variant: 'destructive' })
    } finally {
      setDeduplicatingBookings(false)
    }
  }

  const scanDatabase = async () => {
    setScanning(true)
    try {
      console.log('🔍 Scanning database...')

      const allStaff = await (db as any).staff.list({})
      console.log(`📋 Found ${allStaff.length} staff records`)

      const toKeep = allStaff.filter((staff: StaffMember) => {
        return staff.role === 'admin' || staff.role === 'owner'
      })

      const toDelete = allStaff.filter((staff: StaffMember) => {
        return staff.role !== 'admin' && staff.role !== 'owner'
      })

      setStaffToKeep(toKeep)
      setStaffToDelete(toDelete)
      setScanned(true)

      toast({
        title: 'Scan complete',
        description: `Found ${toDelete.length} accounts to clean`,
      })
    } catch (error: any) {
      console.error('Scan failed:', error)
      toast({
        title: 'Scan failed',
        description: error.message,
        variant: 'destructive'
      })
    } finally {
      setScanning(false)
    }
  }

  const cleanDatabase = async () => {
    if (!confirm(`Are you sure you want to CASCADE DELETE ${staffToDelete.length} employee records and ALL their related data? This cannot be undone.`)) {
      return
    }

    setCleaning(true)
    try {
      console.log('🗑️ Starting cascade cleanup...')
      const currentUser = await auth.me()
      let deleted = 0
      let totalActivityLogs = 0
      let totalBookings = 0
      let totalUserAccounts = 0

      for (const staff of staffToDelete) {
        try {
          console.log(`Cascade deleting: ${staff.name}...`)

          // 1. Delete staff record
          await (db as any).staff.delete(staff.id)
          deleted++

          // 2. Auth-row deletion is intentionally separate — handled via Supabase admin functions, not here
          if (staff.userId && staff.userId !== 'pending') {
            try {
              // With Supabase, we just delete from the database
              // Auth cleanup should be handled separately via Supabase admin functions
              await (db as any).users.delete(staff.userId)
              totalUserAccounts++
              console.log(`  ✅ Deleted user account`)
            } catch (userErr) {
              console.warn(`  ⚠️ Could not delete user account`)
            }
          }

          // 3. Delete activity logs
          try {
            const logs = await (db as any).activityLogs.list({
              where: { userId: staff.userId }
            })
            for (const log of logs) {
              await (db as any).activityLogs.delete(log.id)
              totalActivityLogs++
            }
          } catch (logsErr) {
            console.warn(`  ⚠️ Could not clean activity logs`)
          }

          // 4. Anonymize bookings
          try {
            const bookings = await (db as any).bookings.list({
              where: { userId: staff.userId }
            })
            for (const booking of bookings) {
              await (db as any).bookings.update(booking.id, { userId: null })
              totalBookings++
            }
          } catch (bookingsErr) {
            console.warn(`  ⚠️ Could not anonymize bookings`)
          }

          console.log(`  ✅ Cascade delete complete for ${staff.name}`)
        } catch (error: any) {
          console.error(`Failed to delete ${staff.name}:`, error.message)
        }
      }

      setDeletedCount(deleted)
      setCleaned(true)

      // Log activity
      try {
        await (db as any).activityLogs.create({
          id: `log_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
          userId: currentUser.id,
          action: 'bulk_cascade_delete',
          entityType: 'employee',
          entityId: 'multiple',
          details: JSON.stringify({
            adminEmail: currentUser.email,
            deletedStaffRecords: deleted,
            deletedUserAccounts: totalUserAccounts,
            deletedActivityLogs: totalActivityLogs,
            anonymizedBookings: totalBookings,
            preservedCount: staffToKeep.length,
            timestamp: new Date().toISOString()
          }),
          createdAt: new Date().toISOString()
        })
      } catch (logError) {
        console.warn('Failed to log activity:', logError)
      }

      toast({
        title: 'Cascade cleanup complete!',
        description: `Deleted ${deleted} employees, ${totalUserAccounts} user accounts, ${totalActivityLogs} activity logs`,
      })

      console.log(`✅ Cascade cleanup complete!`)
      console.log(`   Staff records: ${deleted}`)
      console.log(`   User accounts: ${totalUserAccounts}`)
      console.log(`   Activity logs: ${totalActivityLogs}`)
      console.log(`   Bookings anonymized: ${totalBookings}`)
    } catch (error: any) {
      console.error('Cleanup failed:', error)
      toast({
        title: 'Cleanup failed',
        description: error.message,
        variant: 'destructive'
      })
    } finally {
      setCleaning(false)
    }
  }

  // Check permissions
  if (!canManageEmployees) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] space-y-4">
        <Shield className="w-16 h-16 text-destructive" />
        <h2 className="text-2xl font-bold">Access Denied</h2>
        <p className="text-muted-foreground">Only admins can access this tool</p>
      </div>
    )
  }

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      <div>
        <h2 className="text-3xl font-bold">Database Cleanup Tool</h2>
        <p className="text-muted-foreground mt-1">
          Remove test employee accounts (admin accounts are automatically preserved)
        </p>
      </div>

      <Card className="border-amber-200 bg-amber-50">
        <CardHeader>
          <div className="flex items-center gap-3">
            <AlertTriangle className="w-6 h-6 text-amber-600" />
            <div>
              <CardTitle className="text-amber-900">Data Cleanup Actions</CardTitle>
              <CardDescription className="text-amber-700">
                Dangerous actions to wipe data from the system. Proceed with caution.
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            <Button
              variant="outline"
              onClick={clearHousekeepingTasks}
              disabled={cleaningTasks}
              className="border-amber-300 text-amber-800 hover:bg-amber-100"
            >
              {cleaningTasks ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Trash2 className="w-4 h-4 mr-2" />}
              Clear Housekeeping Tasks
            </Button>

            <Button
              variant="outline"
              onClick={clearGuests}
              disabled={cleaningGuests}
              className="border-amber-300 text-amber-800 hover:bg-amber-100"
            >
              {cleaningGuests ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Trash2 className="w-4 h-4 mr-2" />}
              Clear Guests Database
            </Button>

            <Button
              variant="outline"
              onClick={resetRoomStatuses}
              disabled={resettingRooms}
              className="border-amber-300 text-amber-800 hover:bg-amber-100"
            >
              {resettingRooms ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Trash2 className="w-4 h-4 mr-2" />}
              Reset Room Statuses
            </Button>

            <Button
              variant="outline"
              onClick={deduplicateBookings}
              disabled={deduplicatingBookings}
              className="border-amber-300 text-amber-800 hover:bg-amber-100"
            >
              {deduplicatingBookings ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <RefreshCw className="w-4 h-4 mr-2" />}
              Deduplicate Bookings
            </Button>

            <Button
              variant="destructive"
              onClick={clearMockData}
              disabled={cleaningMockData}
            >
              {cleaningMockData ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Trash2 className="w-4 h-4 mr-2" />}
              Clear All Mock Data (Factory Reset)
            </Button>
          </div>
          <p className="text-xs text-amber-800 mt-2">
            "Clear All Mock Data" will delete all bookings, guests, invoices, logs, and reset all properties to "Active".
          </p>
        </CardContent>
      </Card>

      {!scanned && (
        <Card>
          <CardHeader>
            <CardTitle>Step 1: Scan Database</CardTitle>
            <CardDescription>
              First, scan the database to see what will be deleted
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button
              onClick={scanDatabase}
              disabled={scanning}
              size="lg"
              className="w-full"
            >
              {scanning ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Scanning...
                </>
              ) : (
                'Scan Database'
              )}
            </Button>
          </CardContent>
        </Card>
      )}

      {scanned && !cleaned && (
        <>
          <Card>
            <CardHeader>
              <CardTitle>Scan Results</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-3 gap-4">
                <div className="text-center p-4 bg-muted rounded-lg">
                  <div className="text-3xl font-bold">{staffToKeep.length + staffToDelete.length}</div>
                  <div className="text-sm text-muted-foreground">Total Staff</div>
                </div>
                <div className="text-center p-4 bg-green-50 rounded-lg">
                  <div className="text-3xl font-bold text-green-600">{staffToKeep.length}</div>
                  <div className="text-sm text-green-700">Will Preserve</div>
                </div>
                <div className="text-center p-4 bg-red-50 rounded-lg">
                  <div className="text-3xl font-bold text-red-600">{staffToDelete.length}</div>
                  <div className="text-sm text-red-700">Will Delete</div>
                </div>
              </div>

              {staffToKeep.length > 0 && (
                <div>
                  <h3 className="font-semibold mb-2 flex items-center gap-2">
                    <Shield className="w-4 h-4 text-green-600" />
                    Accounts to Preserve
                  </h3>
                  <div className="space-y-2">
                    {staffToKeep.map((staff) => (
                      <div key={staff.id} className="flex items-center justify-between p-3 bg-green-50 rounded-lg border border-green-200">
                        <div>
                          <div className="font-medium">{staff.name}</div>
                          <div className="text-sm text-muted-foreground">{staff.email}</div>
                        </div>
                        <Badge variant="default" className="bg-green-600">{staff.role}</Badge>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {staffToDelete.length > 0 && (
                <div>
                  <h3 className="font-semibold mb-2 flex items-center gap-2">
                    <Trash2 className="w-4 h-4 text-red-600" />
                    Accounts to Delete
                  </h3>
                  <div className="space-y-2 max-h-64 overflow-y-auto">
                    {staffToDelete.map((staff) => (
                      <div key={staff.id} className="flex items-center justify-between p-3 bg-red-50 rounded-lg border border-red-200">
                        <div>
                          <div className="font-medium">{staff.name}</div>
                          <div className="text-sm text-muted-foreground">{staff.email}</div>
                        </div>
                        <Badge variant="outline" className="text-red-600">{staff.role}</Badge>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Step 2: Confirm & Cascade Delete</CardTitle>
              <CardDescription>
                Review the lists above, then proceed with cascade deletion (removes employees and ALL related data)
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button
                onClick={cleanDatabase}
                disabled={cleaning || staffToDelete.length === 0}
                variant="destructive"
                size="lg"
                className="w-full"
              >
                {cleaning ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Cascade Deleting...
                  </>
                ) : (
                  <>
                    <Trash2 className="w-4 h-4 mr-2" />
                    Confirm & Cascade Delete All
                  </>
                )}
              </Button>
              <p className="text-xs text-muted-foreground mt-2 text-center">
                This will delete employees and all their related data (cannot be undone)
              </p>
            </CardContent>
          </Card>
        </>
      )}

      {cleaned && (
        <Card className="border-green-200 bg-green-50">
          <CardHeader>
            <div className="flex items-center gap-3">
              <CheckCircle2 className="w-6 h-6 text-green-600" />
              <div>
                <CardTitle className="text-green-900">Cleanup Complete!</CardTitle>
                <CardDescription className="text-green-700">
                  Database has been cleaned successfully
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="text-green-900">
            <div className="space-y-2">
              <p>✅ Deleted: <strong>{deletedCount}</strong> employee records</p>
              <p>🛡️ Preserved: <strong>{staffToKeep.length}</strong> admin/owner accounts</p>
              <p className="text-sm mt-4">You can now navigate to the Employees page to verify.</p>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}

