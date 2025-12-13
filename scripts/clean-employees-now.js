// Employee Database Cleanup Script
// Deletes all staff except admin@amplodge.com and owner accounts

import { blink } from '../src/blink/client.ts'

async function cleanEmployees() {
  console.log('\n╔════════════════════════════════════════════════════════╗')
  console.log('║  🧹 EMPLOYEE DATABASE CLEANUP                         ║')
  console.log('╚════════════════════════════════════════════════════════╝\n')
  
  try {
    // Verify authentication
    const currentUser = await blink.auth.me()
    if (!currentUser) {
      console.error('❌ Error: Not authenticated. Please login first.')
      process.exit(1)
    }
    
    console.log(`👤 Running as: ${currentUser.email}\n`)
    
    // Get all staff records
    console.log('📋 Fetching all staff records...')
    const allStaff = await blink.db.staff.list({})
    console.log(`   Found: ${allStaff.length} total staff records\n`)
    
    if (allStaff.length === 0) {
      console.log('ℹ️  No staff records found. Nothing to clean.\n')
      process.exit(0)
    }
    
    // Separate into keep and delete
    const staffToKeep = allStaff.filter(staff => {
      return staff.email === 'admin@amplodge.com' || 
             staff.role === 'owner' ||
             (staff.email && staff.email.toLowerCase().includes('admin'))
    })
    
    const staffToDelete = allStaff.filter(staff => {
      return staff.email !== 'admin@amplodge.com' && 
             staff.role !== 'owner' &&
             (!staff.email || !staff.email.toLowerCase().includes('admin'))
    })
    
    // Display what will be kept
    console.log('🛡️  WILL PRESERVE (' + staffToKeep.length + ' accounts):')
    if (staffToKeep.length > 0) {
      staffToKeep.forEach(staff => {
        console.log(`   ✅ ${staff.name.padEnd(25)} ${staff.email.padEnd(30)} [${staff.role}]`)
      })
    }
    console.log('')
    
    // Display what will be deleted
    console.log('🗑️  WILL DELETE (' + staffToDelete.length + ' accounts):')
    if (staffToDelete.length > 0) {
      staffToDelete.forEach(staff => {
        console.log(`   ❌ ${staff.name.padEnd(25)} ${staff.email.padEnd(30)} [${staff.role}]`)
      })
    } else {
      console.log('   (None - only admin accounts exist)')
    }
    console.log('')
    
    if (staffToDelete.length === 0) {
      console.log('✅ Nothing to delete. Database is already clean.\n')
      process.exit(0)
    }
    
    // Execute cleanup
    console.log(`🚀 Starting deletion of ${staffToDelete.length} records...\n`)
    
    let deleted = 0
    let failed = 0
    
    for (const staff of staffToDelete) {
      try {
        console.log(`   Deleting: ${staff.name}...`)
        await blink.db.staff.delete(staff.id)
        deleted++
        console.log(`   ✅ Deleted successfully`)
      } catch (error) {
        failed++
        console.error(`   ❌ Failed: ${error.message}`)
      }
    }
    
    console.log('')
    
    // Log to activity log
    try {
      await blink.db.activityLogs.create({
        id: `log_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
        userId: currentUser.id,
        action: 'bulk_delete',
        entityType: 'employee',
        entityId: 'multiple',
        details: JSON.stringify({
          adminEmail: currentUser.email,
          deletedCount: deleted,
          preservedCount: staffToKeep.length,
          failedCount: failed,
          deletedEmployees: staffToDelete.map(s => ({
            name: s.name,
            email: s.email,
            role: s.role
          })),
          timestamp: new Date().toISOString()
        }),
        createdAt: new Date().toISOString()
      })
      console.log('📝 Activity logged to database\n')
    } catch (logError) {
      console.warn('⚠️  Warning: Could not log activity\n')
    }
    
    // Summary
    console.log('╔════════════════════════════════════════════════════════╗')
    console.log('║  ✅ CLEANUP COMPLETE                                  ║')
    console.log('╚════════════════════════════════════════════════════════╝\n')
    console.log(`   📊 Summary:`)
    console.log(`   ─────────────────────────────────────────────────`)
    console.log(`   ✅ Deleted:   ${deleted} employee records`)
    console.log(`   🛡️  Preserved: ${staffToKeep.length} admin/owner accounts`)
    if (failed > 0) {
      console.log(`   ❌ Failed:    ${failed} deletions`)
    }
    console.log('')
    console.log('   Admin account is safe and preserved! ✅\n')
    
    process.exit(0)
    
  } catch (error) {
    console.error('\n❌ Cleanup failed:', error.message)
    console.error(error)
    process.exit(1)
  }
}

// Run cleanup
cleanEmployees()

