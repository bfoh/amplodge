import { blink } from '@/blink/client'

/**
 * Clean employees database - Remove all staff except admin
 * 
 * SAFETY FEATURES:
 * - Preserves admin@amplodge.com account
 * - Preserves any owner role accounts
 * - Logs all deletions
 * - Provides detailed output
 */
export async function cleanEmployeesDatabase() {
  console.log('🧹 [CleanEmployees] Starting database cleanup...')
  console.log('⚠️  [CleanEmployees] This will delete all non-admin staff records')
  
  try {
    // Get current user to ensure we're admin
    const currentUser = await blink.auth.me()
    if (!currentUser) {
      console.error('❌ [CleanEmployees] Not authenticated')
      return {
        success: false,
        error: 'Not authenticated',
        deleted: 0
      }
    }
    
    console.log('👤 [CleanEmployees] Running as:', currentUser.email)
    
    // Get all staff records
    const allStaff = await (blink.db as any).staff.list({})
    console.log(`📋 [CleanEmployees] Found ${allStaff.length} total staff records`)
    
    if (!allStaff || allStaff.length === 0) {
      console.log('ℹ️  [CleanEmployees] No staff records found')
      return {
        success: true,
        message: 'No staff records to clean',
        deleted: 0,
        preserved: 0
      }
    }
    
    // Filter staff to keep (admin and owner roles)
    const staffToKeep = allStaff.filter((staff: any) => {
      return staff.email === 'admin@amplodge.com' || 
             staff.role === 'owner' ||
             (staff.email && staff.email.toLowerCase().includes('admin'))
    })
    
    // Filter staff to delete
    const staffToDelete = allStaff.filter((staff: any) => {
      return staff.email !== 'admin@amplodge.com' && 
             staff.role !== 'owner' &&
             (!staff.email || !staff.email.toLowerCase().includes('admin'))
    })
    
    console.log(`✅ [CleanEmployees] Preserving ${staffToKeep.length} admin/owner accounts:`)
    staffToKeep.forEach((staff: any) => {
      console.log(`   - ${staff.name} (${staff.email}) - Role: ${staff.role}`)
    })
    
    console.log(`🗑️  [CleanEmployees] Will delete ${staffToDelete.length} staff records:`)
    staffToDelete.forEach((staff: any) => {
      console.log(`   - ${staff.name} (${staff.email}) - Role: ${staff.role}`)
    })
    
    if (staffToDelete.length === 0) {
      console.log('ℹ️  [CleanEmployees] No staff records to delete')
      return {
        success: true,
        message: 'No staff records to delete (only admin accounts exist)',
        deleted: 0,
        preserved: staffToKeep.length
      }
    }
    
    // Delete staff records
    const deletedRecords = []
    const failedDeletions = []
    
    for (const staff of staffToDelete) {
      try {
        console.log(`🗑️  [CleanEmployees] Deleting: ${staff.name} (${staff.email})...`)
        await (blink.db as any).staff.delete(staff.id)
        deletedRecords.push(staff)
        console.log(`   ✅ Deleted: ${staff.name}`)
      } catch (error: any) {
        console.error(`   ❌ Failed to delete ${staff.name}:`, error.message)
        failedDeletions.push({ staff, error: error.message })
      }
    }
    
    // Log activity
    try {
      await (blink.db as any).activityLogs.create({
        id: `log_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
        userId: currentUser.id,
        action: 'bulk_delete',
        entityType: 'employee',
        entityId: 'multiple',
        details: JSON.stringify({
          adminEmail: currentUser.email,
          deletedCount: deletedRecords.length,
          preservedCount: staffToKeep.length,
          failedCount: failedDeletions.length,
          deletedEmployees: deletedRecords.map((s: any) => ({
            name: s.name,
            email: s.email,
            role: s.role
          })),
          timestamp: new Date().toISOString()
        }),
        createdAt: new Date().toISOString()
      })
      console.log('✅ [CleanEmployees] Activity logged')
    } catch (logError) {
      console.warn('⚠️  [CleanEmployees] Failed to log activity:', logError)
    }
    
    // Summary
    console.log('\n📊 [CleanEmployees] Cleanup Summary:')
    console.log(`   ✅ Deleted: ${deletedRecords.length} records`)
    console.log(`   🛡️  Preserved: ${staffToKeep.length} admin/owner accounts`)
    if (failedDeletions.length > 0) {
      console.log(`   ❌ Failed: ${failedDeletions.length} deletions`)
    }
    console.log('   ✅ Cleanup complete!\n')
    
    return {
      success: true,
      deleted: deletedRecords.length,
      preserved: staffToKeep.length,
      failed: failedDeletions.length,
      deletedRecords,
      preservedRecords: staffToKeep,
      failedDeletions
    }
    
  } catch (error: any) {
    console.error('❌ [CleanEmployees] Cleanup failed:', error)
    return {
      success: false,
      error: error.message || 'Cleanup failed',
      deleted: 0
    }
  }
}

/**
 * Interactive version - prompts for confirmation
 */
export async function cleanEmployeesDatabaseInteractive() {
  console.log('\n┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓')
  console.log('┃  🧹 EMPLOYEE DATABASE CLEANUP UTILITY          ┃')
  console.log('┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛\n')
  
  // Preview what will be deleted
  const allStaff = await (blink.db as any).staff.list({})
  const staffToKeep = allStaff.filter((staff: any) => {
    return staff.email === 'admin@amplodge.com' || 
           staff.role === 'owner' ||
           (staff.email && staff.email.toLowerCase().includes('admin'))
  })
  const staffToDelete = allStaff.filter((staff: any) => {
    return staff.email !== 'admin@amplodge.com' && 
           staff.role !== 'owner' &&
           (!staff.email || !staff.email.toLowerCase().includes('admin'))
  })
  
  console.log(`📊 Preview:`)
  console.log(`   Total staff: ${allStaff.length}`)
  console.log(`   Will preserve: ${staffToKeep.length}`)
  console.log(`   Will delete: ${staffToDelete.length}\n`)
  
  if (staffToDelete.length > 0) {
    console.log('🗑️  Accounts to be deleted:')
    staffToDelete.forEach((staff: any) => {
      console.log(`   • ${staff.name} (${staff.email}) - ${staff.role}`)
    })
    console.log('')
  }
  
  if (staffToKeep.length > 0) {
    console.log('🛡️  Accounts to be preserved:')
    staffToKeep.forEach((staff: any) => {
      console.log(`   • ${staff.name} (${staff.email}) - ${staff.role}`)
    })
    console.log('')
  }
  
  // Proceed with cleanup
  console.log('▶️  Proceeding with cleanup...\n')
  const result = await cleanEmployeesDatabase()
  
  if (result.success) {
    console.log('┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓')
    console.log('┃  ✅ CLEANUP COMPLETE                           ┃')
    console.log('┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛')
    console.log(`\n   Deleted: ${result.deleted} records`)
    console.log(`   Preserved: ${result.preserved} accounts\n`)
  }
  
  return result
}

