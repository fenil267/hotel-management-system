const mysql = require('mysql2/promise');
require('dotenv').config();

async function run() {
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME
  });

  try {
    console.log('Running migration...');
    
    // 1. Alter Rooms status
    await conn.query(`ALTER TABLE Rooms MODIFY COLUMN status ENUM('Available', 'Occupied', 'Cleaning', 'Maintenance') NOT NULL DEFAULT 'Available'`);
    console.log('1. Rooms status ENUM updated');

    // 2. Add max_occupancy to Rooms
    try {
      await conn.query(`ALTER TABLE Rooms ADD COLUMN max_occupancy INT NOT NULL DEFAULT 2 AFTER price_per_night`);
      console.log('2. Added max_occupancy column');
    } catch (e) {
      if (!e.message.includes('Duplicate column')) throw e;
      console.log('2. max_occupancy column already exists');
    }
    await conn.query(`UPDATE Rooms SET max_occupancy = 1 WHERE room_type = 'Single'`);
    await conn.query(`UPDATE Rooms SET max_occupancy = 2 WHERE room_type = 'Double'`);
    await conn.query(`UPDATE Rooms SET max_occupancy = 4 WHERE room_type = 'Suite'`);

    // 3. Alter Bookings status
    await conn.query(`ALTER TABLE Bookings MODIFY COLUMN booking_status ENUM('Reserved', 'Confirmed', 'Checked_In', 'Checked_Out', 'Cancelled') NOT NULL DEFAULT 'Confirmed'`);
    console.log('3. Bookings booking_status ENUM updated');

    // 4. Add num_guests to Bookings
    try {
      await conn.query(`ALTER TABLE Bookings ADD COLUMN num_guests INT NOT NULL DEFAULT 1 AFTER room_id`);
      console.log('4. Added num_guests column');
    } catch (e) {
      if (!e.message.includes('Duplicate column')) throw e;
      console.log('4. num_guests column already exists');
    }

    // 5. Triggers
    await conn.query(`DROP TRIGGER IF EXISTS trg_after_booking_insert`);
    await conn.query(`DROP TRIGGER IF EXISTS trg_after_booking_update`);
    await conn.query(`DROP TRIGGER IF EXISTS trg_after_booking_delete`);

    await conn.query(`
      CREATE TRIGGER trg_after_booking_insert
      AFTER INSERT ON Bookings
      FOR EACH ROW
      BEGIN
          IF NEW.booking_status = 'Checked_In' OR (NEW.booking_status = 'Confirmed' AND NEW.check_in_date <= CURDATE() AND NEW.check_out_date > CURDATE()) THEN
              UPDATE Rooms
              SET status = 'Occupied'
              WHERE room_id = NEW.room_id;
          END IF;
      END
    `);

    await conn.query(`
      CREATE TRIGGER trg_after_booking_update
      AFTER UPDATE ON Bookings
      FOR EACH ROW
      BEGIN
          IF NEW.booking_status = 'Checked_In' THEN
              UPDATE Rooms
              SET status = 'Occupied'
              WHERE room_id = NEW.room_id;
          ELSEIF NEW.booking_status = 'Checked_Out' AND OLD.booking_status IN ('Checked_In', 'Confirmed') THEN
              UPDATE Rooms
              SET status = 'Cleaning'
              WHERE room_id = NEW.room_id;
          ELSEIF NEW.booking_status = 'Cancelled' AND OLD.booking_status IN ('Checked_In', 'Confirmed') THEN
              UPDATE Rooms
              SET status = 'Available'
              WHERE room_id = NEW.room_id AND status = 'Occupied';
          END IF;
      END
    `);

    await conn.query(`
      CREATE TRIGGER trg_after_booking_delete
      AFTER DELETE ON Bookings
      FOR EACH ROW
      BEGIN
          IF OLD.booking_status IN ('Checked_In', 'Confirmed') THEN
              UPDATE Rooms
              SET status = 'Available'
              WHERE room_id = OLD.room_id AND status = 'Occupied';
          END IF;
      END
    `);
    console.log('5. Triggers updated');

    // 6. View
    await conn.query(`
      CREATE OR REPLACE VIEW Booking_Details_View AS
      SELECT 
          b.booking_id,
          b.check_in_date,
          b.check_out_date,
          DATEDIFF(b.check_out_date, b.check_in_date) AS total_nights,
          b.num_guests,
          b.total_amount,
          b.booking_status,
          b.booking_date,
          g.guest_id,
          g.full_name AS guest_name,
          g.email AS guest_email,
          g.phone AS guest_phone,
          g.id_proof_number,
          r.room_id,
          r.room_number,
          r.room_type,
          r.max_occupancy,
          r.price_per_night,
          r.status AS current_room_status,
          p.payment_id,
          p.amount_paid,
          p.payment_method,
          p.payment_date
      FROM Bookings b
      INNER JOIN Guests g ON b.guest_id = g.guest_id
      INNER JOIN Rooms r ON b.room_id = r.room_id
      LEFT JOIN Payments p ON b.booking_id = p.booking_id
    `);
    console.log('6. Booking_Details_View updated');

    console.log('SUCCESS: All migrations applied cleanly!');
  } finally {
    await conn.end();
  }
}

run().catch(err => {
  console.error('Migration failed:', err);
  process.exit(1);
});
