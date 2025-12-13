
import { createClient } from '@blinkdotnew/sdk';

// Re-create client locally to avoid Vite import issues
const blink = createClient({
  projectId: 'amp-lodge-hotel-management-system-j2674r7k',
  auth: { mode: 'headless' }
});

async function cleanup() {
  console.log('🚀 Starting Database Cleanup...');

  // 1. Housekeeping Tasks
  try {
    console.log('🧹 Cleaning Housekeeping Tasks...');
    const tasks = await (blink.db as any).housekeepingTasks.list({ limit: 1000 });
    console.log(`Found ${tasks.length} tasks.`);
    for (const task of tasks) {
      await (blink.db as any).housekeepingTasks.delete(task.id);
      process.stdout.write('.');
    }
    console.log('\n✅ Housekeeping Tasks cleared.');
  } catch (e) {
    console.error('❌ Error cleaning tasks:', e);
  }

  // 2. Bookings
  try {
    console.log('🧹 Cleaning Bookings...');
    const bookings = await (blink.db as any).bookings.list({ limit: 1000 });
    console.log(`Found ${bookings.length} bookings.`);
    for (const booking of bookings) {
      await (blink.db as any).bookings.delete(booking.id);
      process.stdout.write('.');
    }
    console.log('\n✅ Bookings cleared.');
  } catch (e) {
    console.error('❌ Error cleaning bookings:', e);
  }

  // 3. Invoices
  try {
    console.log('🧹 Cleaning Invoices...');
    const invoices = await (blink.db as any).invoices.list({ limit: 1000 });
    console.log(`Found ${invoices.length} invoices.`);
    for (const invoice of invoices) {
      await (blink.db as any).invoices.delete(invoice.id);
      process.stdout.write('.');
    }
    console.log('\n✅ Invoices cleared.');
  } catch (e) {
    console.log('ℹ️ No invoices found or table not created.');
  }

  // 4. Guests
  try {
    console.log('🧹 Cleaning Guests...');
    const guests = await (blink.db as any).guests.list({ limit: 1000 });
    console.log(`Found ${guests.length} guests.`);
    for (const guest of guests) {
      await (blink.db as any).guests.delete(guest.id);
      process.stdout.write('.');
    }
    console.log('\n✅ Guests cleared.');
  } catch (e) {
    console.error('❌ Error cleaning guests:', e);
  }

  // 5. Activity Logs
  try {
    console.log('🧹 Cleaning Activity Logs...');
    const logs = await (blink.db as any).activityLogs.list({ limit: 1000 });
    console.log(`Found ${logs.length} logs.`);
    for (const log of logs) {
      await (blink.db as any).activityLogs.delete(log.id);
      process.stdout.write('.');
    }
    console.log('\n✅ Activity Logs cleared.');
  } catch (e) {
    console.error('❌ Error cleaning logs:', e);
  }

  // 6. Reset Rooms
  try {
    console.log('🔄 Resetting Room Statuses...');
    const rooms = await (blink.db as any).rooms.list({ limit: 1000 });
    console.log(`Found ${rooms.length} rooms.`);
    for (const room of rooms) {
      if (room.status !== 'available') {
        await (blink.db as any).rooms.update(room.id, { status: 'available' });
        process.stdout.write('.');
      }
    }
    console.log('\n✅ All rooms reset to Available.');
  } catch (e) {
    console.error('❌ Error resetting rooms:', e);
  }

  console.log('✨ Cleanup Complete!');
}

cleanup();

