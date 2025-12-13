import { blink } from '../blink/client'

/**
 * Fix admin staff record - creates the missing staff record for the authenticated admin user
 * This should be run when logged in as admin@amplodge.com
 */
export async function fixAdminStaffRecord() {
  try {
    console.log('🔧 [fixAdminStaffRecord] Starting admin staff record fix...')
    
    // Get current authenticated user
    const currentUser = await blink.auth.me()
    
    if (!currentUser) {
      throw new Error('No authenticated user found. Please log in first.')
    }
    
    console.log('👤 [fixAdminStaffRecord] Current user:', {
      id: currentUser.id,
      email: currentUser.email
    })
    
    // Try multiple ways to find existing staff record
    let existingStaff = null
    
    // Method 1: Search by email
    try {
      const staffByEmail = await blink.db.staff.list({
        where: { email: currentUser.email }
      })
      if (staffByEmail && staffByEmail.length > 0) {
        existingStaff = staffByEmail[0]
        console.log('✅ [fixAdminStaffRecord] Found staff by email:', existingStaff)
      }
    } catch (e) {
      console.log('⚠️ [fixAdminStaffRecord] Email search failed:', e)
    }
    
    // Method 2: Search by userId (camelCase)
    if (!existingStaff) {
      try {
        const staffByUserId = await blink.db.staff.list({
          where: { userId: currentUser.id }
        })
        if (staffByUserId && staffByUserId.length > 0) {
          existingStaff = staffByUserId[0]
          console.log('✅ [fixAdminStaffRecord] Found staff by userId:', existingStaff)
        }
      } catch (e) {
        console.log('⚠️ [fixAdminStaffRecord] UserId search failed:', e)
      }
    }
    
    // Method 3: Search by user_id (snake_case)
    if (!existingStaff) {
      try {
        const staffByUserIdSnake = await blink.db.staff.list({
          where: { user_id: currentUser.id } as any
        })
        if (staffByUserIdSnake && staffByUserIdSnake.length > 0) {
          existingStaff = staffByUserIdSnake[0]
          console.log('✅ [fixAdminStaffRecord] Found staff by user_id:', existingStaff)
        }
      } catch (e) {
        console.log('⚠️ [fixAdminStaffRecord] user_id search failed:', e)
      }
    }
    
    // Method 4: List all and filter manually
    if (!existingStaff) {
      try {
        console.log('🔄 [fixAdminStaffRecord] Listing all staff records...')
        const allStaff = await blink.db.staff.list({})
        console.log('📋 [fixAdminStaffRecord] All staff records:', allStaff)
        
        existingStaff = allStaff.find((s: any) => 
          s.email === currentUser.email || 
          s.userId === currentUser.id || 
          s.user_id === currentUser.id
        )
        
        if (existingStaff) {
          console.log('✅ [fixAdminStaffRecord] Found staff in manual search:', existingStaff)
        }
      } catch (e) {
        console.log('⚠️ [fixAdminStaffRecord] Manual search failed:', e)
      }
    }
    
    if (existingStaff) {
      console.log('✅ [fixAdminStaffRecord] Staff record already exists:', {
        id: existingStaff.id,
        email: existingStaff.email,
        role: existingStaff.role,
        userId: existingStaff.userId || existingStaff.user_id
      })
      return { success: true, alreadyExists: true, staff: existingStaff }
    }
    
    // Create the staff record
    console.log('📝 [fixAdminStaffRecord] Creating staff record...')
    const newStaff = await blink.db.staff.create({
      id: `staff_admin_${Date.now()}`,
      userId: currentUser.id,
      name: 'Admin User',
      email: currentUser.email,
      role: 'admin',
      createdAt: new Date().toISOString()
    })
    
    console.log('✅ [fixAdminStaffRecord] Staff record created successfully:', newStaff)
    
    return { 
      success: true, 
      alreadyExists: false, 
      staff: newStaff 
    }
    
  } catch (error) {
    console.error('❌ [fixAdminStaffRecord] Error:', error)
    
    // If it's a 409 conflict, the record probably exists but we can't find it
    if (error.message?.includes('409') || error.message?.includes('Constraint violation')) {
      console.log('💡 [fixAdminStaffRecord] Record exists but detection failed. Trying manual refresh...')
      
      // Force refresh the useStaffRole hook
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('refreshStaffRole'))
      }
      
      return { success: true, alreadyExists: true, error: 'Detection failed but record exists' }
    }
    
    return { success: false, error }
  }
}

// Auto-run this function when imported (only in browser)
if (typeof window !== 'undefined') {
  // Run after a short delay to ensure auth is ready
  setTimeout(async () => {
    const currentUser = await blink.auth.me()
    if (currentUser?.email === 'admin@amplodge.com') {
      console.log('🚀 [fixAdminStaffRecord] Auto-fixing admin staff record...')
      await fixAdminStaffRecord()
    }
  }, 1000)
}
