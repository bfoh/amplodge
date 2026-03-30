/**
 * Blink Database Schema Definition
 * This file defines the database schema for the AMP Lodge Hotel Management System
 */

import { blink } from './client'

// Define the activityLogs table schema
export interface ActivityLogRecord {
  id: string
  action: string
  entityType: string
  entityId: string
  details: string // JSON string
  userId: string
  metadata: string // JSON string
  createdAt: string
}

/**
 * Initialize the database schema by creating all required tables
 * This function ensures that all tables exist before the application starts
 */
export async function initializeDatabaseSchema(): Promise<void> {
  try {
    console.log('[DatabaseSchema] Initializing database schema...')

    const db = blink.db as any

    // List of tables that should exist
    const requiredTables = [
      'activityLogs',
      'staff',
      'bookings',
      'rooms',
      'roomTypes',
      'guests',
      'invoices',
      'contactMessages',
      'properties',
      'hotelSettings',
      'housekeepingTasks',
      'hr_attendance',
      'hr_leave_requests',
      'hr_payroll',
      'hr_performance_reviews',
      'hr_job_applications',
      'hr_weekly_revenue',
      'standaloneSales'
    ]

    // Test each table and create if necessary
    for (const tableName of requiredTables) {
      try {
        // Try to access the table
        await db[tableName].list({ limit: 1 })
        console.log(`[DatabaseSchema] ✅ Table '${tableName}' exists`)
      } catch (error: any) {
        console.log(`[DatabaseSchema] ⚠️ Table '${tableName}' does not exist, creating...`)

        // For activityLogs, create it by inserting a record
        if (tableName === 'activityLogs') {
          try {
            const initRecord: ActivityLogRecord = {
              id: `schema_init_${Date.now()}`,
              action: 'schema_init',
              entityType: 'system',
              entityId: 'database_schema',
              details: JSON.stringify({
                message: 'Database schema initialization',
                timestamp: new Date().toISOString(),
                version: '1.0'
              }),
              userId: 'system',
              metadata: JSON.stringify({
                source: 'schema_initialization',
                table: 'activityLogs'
              }),
              createdAt: new Date().toISOString(),
            }

            await db.activityLogs.create(initRecord)
            console.log(`[DatabaseSchema] ✅ Created '${tableName}' table`)

            // Clean up the initialization record
            try {
              await db.activityLogs.delete(initRecord.id)
              console.log(`[DatabaseSchema] ✅ Cleaned up initialization record`)
            } catch (cleanupError) {
              console.warn(`[DatabaseSchema] ⚠️ Could not clean up initialization record:`, cleanupError)
            }

          } catch (createError: any) {
            console.error(`[DatabaseSchema] ❌ Failed to create '${tableName}' table:`, createError.message)
            // Don't throw, allowing app to load even if table creation fails
            console.warn(`[DatabaseSchema] ⚠️ Continuing without '${tableName}' table`)
          }
        } else if (tableName === 'hotelSettings') {
          try {
            const defaultSettings = {
              id: 'hotel-settings-amp-lodge',
              name: 'AMP Lodge',
              address: 'AMP LODGE, Abuakwa DKC junction, Kumasi-Sunyani Rd, Kumasi, Ghana',
              phone: '+233 55 500 9697',
              email: 'info@amplodge.org',
              website: 'https://amplodge.org',
              logoUrl: '/amp.png',
              taxRate: 0.10,
              currency: 'GHS',
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString()
            }

            await db.hotelSettings.create(defaultSettings)
            console.log(`[DatabaseSchema] ✅ Created '${tableName}' table with default settings`)
          } catch (createError: any) {
            console.error(`[DatabaseSchema] ❌ Failed to create '${tableName}' table:`, createError.message)
            // Don't throw, allowing other tables to proceed
          }
        } else if (tableName === 'hr_attendance') {
          try {
            const initRecord = {
              id: `hr_att_init_${Date.now()}`,
              staffId: 'system',
              staffName: 'System',
              date: new Date().toISOString().split('T')[0],
              clockIn: '',
              clockOut: '',
              hoursWorked: 0,
              status: 'init',
              notes: 'Schema initialization',
              createdAt: new Date().toISOString()
            }
            await db.hr_attendance.create(initRecord)
            await db.hr_attendance.delete(initRecord.id)
            console.log(`[DatabaseSchema] ✅ Created '${tableName}' table`)
          } catch (createError: any) {
            console.warn(`[DatabaseSchema] ⚠️ Could not auto-create '${tableName}':`, createError.message)
          }
        } else if (tableName === 'hr_leave_requests') {
          try {
            const initRecord = {
              id: `hr_leave_init_${Date.now()}`,
              staffId: 'system',
              staffName: 'System',
              leaveType: 'annual',
              startDate: new Date().toISOString().split('T')[0],
              endDate: new Date().toISOString().split('T')[0],
              reason: 'Schema initialization',
              status: 'init',
              reviewedBy: '',
              reviewedAt: '',
              createdAt: new Date().toISOString()
            }
            await db.hr_leave_requests.create(initRecord)
            await db.hr_leave_requests.delete(initRecord.id)
            console.log(`[DatabaseSchema] ✅ Created '${tableName}' table`)
          } catch (createError: any) {
            console.warn(`[DatabaseSchema] ⚠️ Could not auto-create '${tableName}':`, createError.message)
          }
        } else if (tableName === 'hr_payroll') {
          try {
            const initRecord = {
              id: `hr_pay_init_${Date.now()}`,
              staffId: 'system',
              staffName: 'System',
              period: new Date().toISOString().substring(0, 7),
              baseSalary: 0,
              allowances: 0,
              deductions: 0,
              netPay: 0,
              paymentStatus: 'init',
              paymentDate: '',
              notes: 'Schema initialization',
              createdAt: new Date().toISOString()
            }
            await db.hr_payroll.create(initRecord)
            await db.hr_payroll.delete(initRecord.id)
            console.log(`[DatabaseSchema] ✅ Created '${tableName}' table`)
          } catch (createError: any) {
            console.warn(`[DatabaseSchema] ⚠️ Could not auto-create '${tableName}':`, createError.message)
          }
        } else if (tableName === 'hr_performance_reviews') {
          try {
            const initRecord = {
              id: `hr_perf_init_${Date.now()}`,
              staffId: 'system',
              staffName: 'System',
              reviewerId: 'system',
              reviewerName: 'System',
              reviewDate: new Date().toISOString().split('T')[0],
              rating: 0,
              strengths: 'Schema initialization',
              improvements: '',
              notes: '',
              createdAt: new Date().toISOString()
            }
            await db.hr_performance_reviews.create(initRecord)
            await db.hr_performance_reviews.delete(initRecord.id)
            console.log(`[DatabaseSchema] ✅ Created '${tableName}' table`)
          } catch (createError: any) {
            console.warn(`[DatabaseSchema] ⚠️ Could not auto-create '${tableName}':`, createError.message)
          }
        } else if (tableName === 'hr_job_applications') {
          try {
            const initRecord = {
              id: `hr_app_init_${Date.now()}`,
              applicantName: 'System',
              email: 'system@init.local',
              phone: '',
              position: 'init',
              experience: '',
              skills: '',
              coverLetter: 'Schema initialization',
              status: 'init',
              reviewedBy: '',
              interviewDate: '',
              notes: '',
              createdAt: new Date().toISOString()
            }
            await db.hr_job_applications.create(initRecord)
            await db.hr_job_applications.delete(initRecord.id)
            console.log(`[DatabaseSchema] ✅ Created '${tableName}' table`)
          } catch (createError: any) {
            console.warn(`[DatabaseSchema] ⚠️ Could not auto-create '${tableName}':`, createError.message)
          }
        } else if (tableName === 'hr_weekly_revenue') {
          try {
            const initRecord = {
              id: `hr_rev_init_${Date.now()}`,
              staffId: 'system',
              staffName: 'System',
              weekStart: new Date().toISOString().split('T')[0],
              weekEnd: new Date().toISOString().split('T')[0],
              totalRevenue: 0,
              bookingCount: 0,
              bookingIds: '[]',
              status: 'init',
              notes: '',
              adminNotes: '',
              reviewedBy: '',
              reviewedAt: '',
              submittedAt: '',
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString()
            }
            await db.hr_weekly_revenue.create(initRecord)
            await db.hr_weekly_revenue.delete(initRecord.id)
            console.log(`[DatabaseSchema] ✅ Created '${tableName}' table`)
          } catch (createError: any) {
            console.warn(`[DatabaseSchema] ⚠️ Could not auto-create '${tableName}':`, createError.message)
          }
        } else if (tableName === 'standaloneSales') {
          try {
            const initRecord = {
              id: `sale_init_${Date.now()}`,
              description: 'Schema initialization',
              category: 'other',
              quantity: 1,
              unitPrice: 0,
              amount: 0,
              notes: '',
              staffId: 'system',
              staffName: 'System',
              saleDate: new Date().toISOString().split('T')[0],
              paymentMethod: 'cash',
              createdAt: new Date().toISOString()
            }
            await db.standaloneSales.create(initRecord)
            await db.standaloneSales.delete(initRecord.id)
            console.log(`[DatabaseSchema] ✅ Created '${tableName}' table`)
          } catch (createError: any) {
            console.warn(`[DatabaseSchema] ⚠️ Could not auto-create '${tableName}':`, createError.message)
          }
        } else {
          console.warn(`[DatabaseSchema] ⚠️ Table '${tableName}' does not exist and cannot be auto-created`)
        }
      }
    }

    console.log('[DatabaseSchema] ✅ Database schema initialization completed')

  } catch (error: any) {
    console.error('[DatabaseSchema] ❌ Database schema initialization failed:', error.message)
    throw error
  }
}

/**
 * Verify that the activityLogs table is working correctly
 */
export async function verifyActivityLogsTable(): Promise<boolean> {
  try {
    console.log('[DatabaseSchema] Verifying activityLogs table...')

    const db = blink.db as any

    // Test 1: Can read
    const readTest = await db.activityLogs.list({ limit: 1 })
    console.log('[DatabaseSchema] ✅ Read test passed')

    // Test 2: Can create
    const testRecord: ActivityLogRecord = {
      id: `verify_${Date.now()}`,
      action: 'verify',
      entityType: 'test',
      entityId: 'verification',
      details: JSON.stringify({ test: true }),
      userId: 'system',
      metadata: JSON.stringify({}),
      createdAt: new Date().toISOString(),
    }

    await db.activityLogs.create(testRecord)
    console.log('[DatabaseSchema] ✅ Create test passed')

    // Test 3: Can read the created record
    const createdRecord = await db.activityLogs.get(testRecord.id)
    console.log('[DatabaseSchema] ✅ Get test passed')

    // Test 4: Can delete
    await db.activityLogs.delete(testRecord.id)
    console.log('[DatabaseSchema] ✅ Delete test passed')

    console.log('[DatabaseSchema] ✅ All activityLogs table tests passed')
    return true

  } catch (error: any) {
    console.error('[DatabaseSchema] ❌ ActivityLogs table verification failed:', error.message)
    return false
  }
}

/**
 * Create sample activity logs for testing
 */
export async function createSampleActivityLogs(): Promise<void> {
  try {
    console.log('[DatabaseSchema] Creating sample activity logs...')

    const db = blink.db as any

    const sampleLogs: ActivityLogRecord[] = [
      {
        id: `sample_booking_${Date.now()}`,
        action: 'created',
        entityType: 'booking',
        entityId: `booking_${Date.now()}`,
        details: JSON.stringify({
          guestName: 'John Doe',
          roomNumber: '101',
          amount: 150,
          checkIn: '2024-01-15',
          checkOut: '2024-01-17'
        }),
        userId: 'system',
        metadata: JSON.stringify({ source: 'sample_data' }),
        createdAt: new Date().toISOString(),
      },
      {
        id: `sample_guest_${Date.now()}`,
        action: 'updated',
        entityType: 'guest',
        entityId: `guest_${Date.now()}`,
        details: JSON.stringify({
          name: 'Jane Smith',
          email: 'jane@example.com',
          phone: '+1234567890'
        }),
        userId: 'system',
        metadata: JSON.stringify({ source: 'sample_data' }),
        createdAt: new Date().toISOString(),
      },
      {
        id: `sample_invoice_${Date.now()}`,
        action: 'deleted',
        entityType: 'invoice',
        entityId: `invoice_${Date.now()}`,
        details: JSON.stringify({
          invoiceNumber: 'INV-SAMPLE-001',
          amount: 200,
          status: 'cancelled'
        }),
        userId: 'system',
        metadata: JSON.stringify({ source: 'sample_data' }),
        createdAt: new Date().toISOString(),
      }
    ]

    for (const log of sampleLogs) {
      try {
        await db.activityLogs.create(log)
        console.log(`[DatabaseSchema] ✅ Created sample log: ${log.action} ${log.entityType}`)
      } catch (error: any) {
        console.error(`[DatabaseSchema] ❌ Failed to create sample log:`, error.message)
      }
    }

    console.log('[DatabaseSchema] ✅ Sample activity logs creation completed')

  } catch (error: any) {
    console.error('[DatabaseSchema] ❌ Failed to create sample activity logs:', error.message)
    throw error
  }
}
