/**
 * Test utility for unique headings fix
 */

import { blink } from '@/blink/client'

/**
 * Test the unique headings fix by creating sample data
 */
export async function testUniqueHeadingsFix(): Promise<void> {
  console.log('[UniqueHeadingsFix] Testing unique headings fix...')
  
  try {
    const db = blink.db as any
    
    // Create sample contact messages with different names to test unique headings
    const sampleContacts = [
      {
        id: `contact_${Date.now()}_1`,
        name: 'Alice Johnson',
        email: 'alice@example.com',
        message: 'Test message from Alice',
        status: 'unread',
        createdAt: new Date().toISOString()
      },
      {
        id: `contact_${Date.now()}_2`,
        name: 'Bob Smith',
        email: 'bob@example.com',
        message: 'Test message from Bob',
        status: 'unread',
        createdAt: new Date().toISOString()
      },
      {
        id: `contact_${Date.now()}_3`,
        name: 'Charlie Brown',
        email: 'charlie@example.com',
        message: 'Test message from Charlie',
        status: 'unread',
        createdAt: new Date().toISOString()
      },
      {
        id: `contact_${Date.now()}_4`,
        email: 'diana@example.com',
        message: 'Test message from Diana (no name)',
        status: 'unread',
        createdAt: new Date().toISOString()
      }
    ]

    // Create the sample contact messages
    for (const contact of sampleContacts) {
      try {
        await db.contactMessages.create(contact)
        console.log(`[UniqueHeadingsFix] Created contact message: ${contact.name || contact.email}`)
      } catch (error) {
        console.error(`[UniqueHeadingsFix] Failed to create contact message:`, error)
      }
    }

    console.log('[UniqueHeadingsFix] ✅ Sample contact messages created')
    console.log('[UniqueHeadingsFix] Check the History page to see unique headings:')
    console.log('[UniqueHeadingsFix] - "Contact message from Alice Johnson"')
    console.log('[UniqueHeadingsFix] - "Contact message from Bob Smith"')
    console.log('[UniqueHeadingsFix] - "Contact message from Charlie Brown"')
    console.log('[UniqueHeadingsFix] - "Contact message from diana@example.com"')

  } catch (error) {
    console.error('[UniqueHeadingsFix] ❌ Test failed:', error)
  }
}

/**
 * Clean up test contact messages
 */
export async function cleanupTestContactMessages(): Promise<void> {
  console.log('[UniqueHeadingsFix] Cleaning up test contact messages...')
  
  try {
    const db = blink.db as any
    
    // Get all contact messages
    const contacts = await db.contactMessages.list()
    
    // Filter test contact messages
    const testContacts = contacts.filter((contact: any) => 
      contact.id.includes('contact_') && 
      contact.message.includes('Test message')
    )
    
    console.log(`[UniqueHeadingsFix] Found ${testContacts.length} test contact messages to delete`)
    
    // Delete test contact messages
    for (const contact of testContacts) {
      try {
        await db.contactMessages.delete(contact.id)
        console.log(`[UniqueHeadingsFix] Deleted test contact: ${contact.name || contact.email}`)
      } catch (error) {
        console.error(`[UniqueHeadingsFix] Failed to delete contact:`, error)
      }
    }
    
    console.log('[UniqueHeadingsFix] ✅ Test contact messages cleaned up')

  } catch (error) {
    console.error('[UniqueHeadingsFix] ❌ Cleanup failed:', error)
  }
}

// Make functions globally accessible for console access
if (typeof window !== 'undefined') {
  (window as any).testUniqueHeadingsFix = testUniqueHeadingsFix
  (window as any).cleanupTestContactMessages = cleanupTestContactMessages
  console.log('[UniqueHeadingsFix] Test functions available globally:')
  console.log('  - testUniqueHeadingsFix() - Test unique headings fix')
  console.log('  - cleanupTestContactMessages() - Clean up test contact messages')
}





