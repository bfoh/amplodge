import { blink } from '../blink/client'

/**
 * Debug function to check what's in the staff database
 */
export async function debugStaffDatabase() {
  try {
    console.log('🔍 [debugStaffDatabase] Starting debug...')
    
    // Get current user
    const currentUser = await blink.auth.me()
    console.log('👤 [debugStaffDatabase] Current user:', currentUser)
    
    // List all staff records
    console.log('📋 [debugStaffDatabase] Fetching all staff records...')
    const allStaff = await blink.db.staff.list({})
    console.log('📋 [debugStaffDatabase] All staff records:', allStaff)
    
    // Check if any match current user
    const matchingStaff = allStaff.filter((s: any) => 
      s.email === currentUser?.email || 
      s.userId === currentUser?.id || 
      s.user_id === currentUser?.id
    )
    
    console.log('🎯 [debugStaffDatabase] Matching staff records:', matchingStaff)
    
    if (matchingStaff.length > 0) {
      const staff = matchingStaff[0]
      console.log('✅ [debugStaffDatabase] Found matching staff:', {
        id: staff.id,
        email: staff.email,
        role: staff.role,
        userId: staff.userId || staff.user_id,
        name: staff.name
      })
      
      // Check if role is admin
      if (staff.role === 'admin') {
        console.log('✅ [debugStaffDatabase] Role is admin - should show employees tab!')
      } else {
        console.log('❌ [debugStaffDatabase] Role is not admin:', staff.role)
      }
    } else {
      console.log('❌ [debugStaffDatabase] No matching staff record found!')
    }
    
    return { success: true, allStaff, matchingStaff }
    
  } catch (error) {
    console.error('❌ [debugStaffDatabase] Error:', error)
    return { success: false, error }
  }
}

// Auto-run in browser
if (typeof window !== 'undefined') {
  setTimeout(() => {
    debugStaffDatabase()
  }, 2000)
}
