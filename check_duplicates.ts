
import { blink } from './src/blink/client';

async function checkDuplicates() {
  console.log('Checking for duplicate bookings...');
  const bookings = await (blink.db as any).bookings.list({ limit: 1000 });
  console.log(`Total bookings fetched: ${bookings.length}`);

  const idMap = new Map();
  const contentMap = new Map();

  bookings.forEach((b: any) => {
    // Check duplicate IDs
    if (idMap.has(b.id)) {
      console.log(`Duplicate ID found: ${b.id}`);
      idMap.get(b.id).push(b);
    } else {
      idMap.set(b.id, [b]);
    }

    // Check duplicate content (guestId + roomId + checkIn + checkOut)
    const key = `${b.guestId}-${b.roomId}-${b.checkIn}-${b.checkOut}`;
    if (contentMap.has(key)) {
      contentMap.get(key).push(b);
    } else {
      contentMap.set(key, [b]);
    }
  });

  console.log('\n--- Duplicate IDs ---');
  let duplicateIdCount = 0;
  idMap.forEach((list, id) => {
    if (list.length > 1) {
      console.log(`ID ${id} appears ${list.length} times.`);
      duplicateIdCount++;
    }
  });
  if (duplicateIdCount === 0) console.log('No duplicate IDs found.');

  console.log('\n--- Duplicate Content ---');
  let duplicateContentCount = 0;
  contentMap.forEach((list, key) => {
    if (list.length > 1) {
      console.log(`Content key ${key} appears ${list.length} times. IDs: ${list.map((b: any) => b.id).join(', ')}`);
      duplicateContentCount++;
    }
  });
  if (duplicateContentCount === 0) console.log('No bookings with identical content found.');
}

checkDuplicates();

