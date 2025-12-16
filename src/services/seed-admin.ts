import { blink } from '../blink/client'

/**
 * @deprecated This file is LEGACY code from the Blink era.
 * After migrating to Supabase, admin accounts should be created directly in Supabase Auth.
 * This file is retained for reference only and should NOT be used in production.
 * 
 * Seed admin account for AMP Lodge
 * ONLY RUNS IN DEVELOPMENT - NOT IN PRODUCTION
 * 
 * In production, admin accounts must be created manually through the Supabase dashboard
 */
export async function seedAdminAccount() {
  // Skip admin seeding in production - admin should be created manually
  if (import.meta.env.PROD) {
    console.log('🔒 Production mode: Skipping admin account seeding')
    console.log('⚠️ Admin accounts must be created manually through Supabase dashboard')
    return { success: true, alreadyExists: true, skipped: true }
  }

  // DEPRECATED: These should come from environment variables or Supabase Auth
  const adminEmail = import.meta.env.VITE_ADMIN_EMAIL || 'admin@amplodge.com'
  const adminPassword = '[PASSWORD_REMOVED - Set in Supabase Auth]'
  console.warn('⚠️ DEPRECATED: seed-admin.ts is legacy code. Use Supabase Auth dashboard instead.')

  try {
    // Check if we need to log out first (in case seed ran while another user was logged in)
    const currentAuthUser = await blink.auth.me()
    const wasAlreadyLoggedIn = !!currentAuthUser

    // Defer staff existence check until after authentication to ensure proper DB access

    // Sign up the admin user
    try {
      await blink.auth.signUp({
        email: adminEmail,
        password: adminPassword,
      })
      console.log('✅ Admin user account created')
    } catch (error: any) {
      // If user already exists, sign in to get the user ID
      if (error.message?.includes('already exists') || error.message?.includes('User already registered')) {
        console.log('ℹ️ Admin user already exists, signing in temporarily to check staff record...')
        await blink.auth.signInWithEmail(adminEmail, adminPassword)
      } else {
        throw error
      }
    }

    // Get current user to obtain userId
    const currentUser = await blink.auth.me()

    if (!currentUser) {
      throw new Error('Failed to get admin user after signup/signin')
    }

    console.log('🔍 Checking for existing admin staff record...')

    // Check again (with auth) if staff already exists
    const db = (blink.db as any)
    const existingStaff = await db.staff.list({
      where: { email: adminEmail },
      limit: 1
    })

    if (existingStaff.length > 0) {
      console.log('✅ Admin staff record already exists:', {
        id: existingStaff[0].id,
        role: existingStaff[0].role,
        userId: existingStaff[0].userId || existingStaff[0].user_id
      })

      // Log out if we logged in just for seeding
      if (!wasAlreadyLoggedIn) {
        await blink.auth.logout()
        console.log('🔓 Logged out after seed check')
      }

      return { success: true, alreadyExists: true }
    }

    // Create staff entry (gracefully handle 409 duplicate)
    console.log('📝 Creating admin staff record...')
    try {
      const newStaff = await db.staff.create({
        id: `staff_admin_${Date.now()}`,
        userId: currentUser.id,
        name: 'Admin User',
        email: adminEmail,
        role: 'admin',
        createdAt: new Date().toISOString()
      })

      console.log('✅ Admin staff entry created successfully:', {
        id: newStaff.id,
        role: newStaff.role,
        userId: newStaff.userId || newStaff.user_id
      })
    } catch (e: any) {
      const message = e?.message || ''
      const status = e?.status
      const details = e?.details?.message || e?.details?.details?.error_details || ''
      if (status === 409 || message.includes('Constraint violation') || String(details).includes('UNIQUE')) {
        console.log('✅ Admin staff already exists (caught 409). Skipping.')

        // Log out if we logged in just for seeding
        if (!wasAlreadyLoggedIn) {
          await blink.auth.logout()
          console.log('🔓 Logged out after seed check')
        }

        return { success: true, alreadyExists: true }
      }
      throw e
    }

    // Log out if we logged in just for seeding
    if (!wasAlreadyLoggedIn) {
      await blink.auth.logout()
      console.log('🔓 Logged out after seed completion')
    }

    return {
      success: true,
      alreadyExists: false,
      credentials: {
        email: adminEmail,
        password: adminPassword
      }
    }
  } catch (error) {
    console.error('❌ Error seeding admin account:', error)
    return { success: false, error }
  }
}

/**
 * Seed test staff account
 * Email: bfoh2g@gmail.com
 * Password: Akowuah@b4
 */
export async function seedTestStaffAccount() {
  try {
    const staffEmail = 'bfoh2g@gmail.com'
    const staffPassword = 'Akowuah@b4'

    // Sign up the test staff user
    try {
      await blink.auth.signUp({
        email: staffEmail,
        password: staffPassword,
      })
      console.log('Test staff user account created')
    } catch (error: any) {
      // If user already exists, sign in to get the user ID
      if (error.message?.includes('already exists') || error.message?.includes('User already registered')) {
        console.log('Test staff user already exists, signing in...')
        await blink.auth.signInWithEmail(staffEmail, staffPassword)
      } else {
        throw error
      }
    }

    // Get current user to obtain userId
    const currentUser = await blink.auth.me()

    if (!currentUser) {
      throw new Error('Failed to get test staff user after signup/signin')
    }

    // Check if staff entry already exists
    const db = (blink.db as any)
    const existingStaff = await db.staff.list({
      where: { email: staffEmail },
      limit: 1
    })
    if (existingStaff.length > 0) {
      console.log('Test staff entry already exists, skipping creation')
      await blink.auth.logout()
      return { success: true, alreadyExists: true }
    }

    // Create staff entry
    try {
      await db.staff.create({
        id: `staff_test_${Date.now()}`,
        userId: currentUser.id,
        name: 'Test Staff',
        email: staffEmail,
        role: 'staff',
        createdAt: new Date().toISOString()
      })
    } catch (e: any) {
      const message = e?.message || ''
      const status = e?.status
      const details = e?.details?.message || e?.details?.details?.error_details || ''
      if (status === 409 || message.includes('Constraint violation') || String(details).includes('UNIQUE')) {
        console.log('Test staff entry already exists (caught 409). Skipping.')
        await blink.auth.logout()
        return { success: true, alreadyExists: true }
      }
      throw e
    }

    console.log('Test staff entry created successfully')
    await blink.auth.logout()

    return {
      success: true,
      alreadyExists: false,
      credentials: {
        email: staffEmail,
        password: staffPassword
      }
    }
  } catch (error) {
    console.error('Error seeding test staff account:', error)
    try {
      await blink.auth.logout()
    } catch (e) { /* ignore logout error */ }
    return { success: false, error }
  }
}
