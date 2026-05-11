import { db } from '../src/lib/db';

async function checkTables() {
  try {
    const rooms = await (db as any).rooms.list();
    const properties = await (db as any).properties.list();
    console.log('Rooms count:', rooms.length);
    console.log('Properties count:', properties.length);
    if (rooms.length > 0) {
      console.log('First room:', JSON.stringify(rooms[0], null, 2));
    }
    if (properties.length > 0) {
      console.log('First property:', JSON.stringify(properties[0], null, 2));
    }
  } catch (err) {
    console.error('Error checking tables:', err);
  }
}

checkTables();
