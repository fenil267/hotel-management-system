const express = require('express');
const cors = require('cors');
const path = require('path');
const mysql = require('mysql2/promise');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// MySQL Connection Pool Configuration
const dbUri = process.env.MYSQL_URL || process.env.DATABASE_URL;
const pool = dbUri
  ? mysql.createPool(dbUri)
  : mysql.createPool({
      host: process.env.DB_HOST || 'localhost',
      user: process.env.DB_USER || 'root',
      password: process.env.DB_PASSWORD || '',
      database: process.env.DB_NAME || 'hotel_db',
      port: Number(process.env.DB_PORT) || 3306,
      waitForConnections: true,
      connectionLimit: 10,
      queueLimit: 0,
      dateStrings: true
    });

// Helper for consistent error formatting (demonstrates DBMS constraint checks)
function formatDbError(err) {
  if (err.code === 'ER_DUP_ENTRY') {
    return `Unique Constraint Violation: A record with that identifier or room number already exists. (${err.sqlMessage || err.message})`;
  }
  if (err.code === 'ER_CHECK_CONSTRAINT_VIOLATED') {
    return `Check Constraint Violation: Provided values violate relational integrity rules (e.g., checkout must be after check-in, or price/guests must be > 0).`;
  }
  if (err.code === 'ER_ROW_IS_REFERENCED_2' || err.code === 'ER_NO_REFERENCED_ROW_2') {
    return `Foreign Key Constraint Violation: Referenced entity does not exist or is protected by relational constraints.`;
  }
  return err.sqlMessage || err.message || 'Database execution error';
}

// ----------------------------------------------------
// 0. HEALTH CHECK API
// ----------------------------------------------------
app.get('/api/health', async (req, res) => {
  try {
    const [result] = await pool.query('SELECT 1 AS alive');
    res.json({
      success: true,
      db_connected: result.length > 0,
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      db_connected: false,
      error: err.message
    });
  }
});

// ----------------------------------------------------
// 1. DASHBOARD & ANALYTICS APIs
// ----------------------------------------------------
app.get('/api/stats', async (req, res) => {
  try {
    // Total Revenue excluding cancelled bookings
    const [[revenueRow]] = await pool.query(`
      SELECT COALESCE(SUM(p.amount_paid), 0) AS total_revenue 
      FROM Payments p
      INNER JOIN Bookings b ON p.booking_id = b.booking_id
      WHERE b.booking_status != 'Cancelled'
    `);

    // Total Bookings
    const [[bookingsRow]] = await pool.query(`SELECT COUNT(*) AS total_bookings FROM Bookings`);
    
    // Active Stays (currently checked in)
    const [[activeStaysRow]] = await pool.query(`SELECT COUNT(*) AS active_stays FROM Bookings WHERE booking_status = 'Checked_In'`);

    // Expected arrivals today
    const [[arrivalsRow]] = await pool.query(`
      SELECT COUNT(*) AS arrivals_today 
      FROM Bookings 
      WHERE check_in_date = CURDATE() AND booking_status IN ('Reserved', 'Confirmed')
    `);

    // Expected departures today
    const [[departuresRow]] = await pool.query(`
      SELECT COUNT(*) AS departures_today 
      FROM Bookings 
      WHERE check_out_date = CURDATE() AND booking_status = 'Checked_In'
    `);

    // Room stats
    const [[roomsRow]] = await pool.query(`
      SELECT 
        COUNT(*) AS total_rooms,
        COALESCE(SUM(status = 'Available'), 0) AS available_rooms,
        COALESCE(SUM(status = 'Occupied'), 0) AS occupied_rooms,
        COALESCE(SUM(status = 'Cleaning'), 0) AS cleaning_rooms,
        COALESCE(SUM(status = 'Maintenance'), 0) AS maintenance_rooms
      FROM Rooms
    `);

    // Total guests
    const [[guestsRow]] = await pool.query(`SELECT COUNT(*) AS total_guests FROM Guests`);

    const totalRooms = Number(roomsRow.total_rooms) || 0;
    const occupiedRooms = Number(roomsRow.occupied_rooms) || 0;
    const occupancyRate = totalRooms > 0 ? ((occupiedRooms / totalRooms) * 100).toFixed(1) : '0.0';

    res.json({
      success: true,
      data: {
        total_revenue: Number(revenueRow.total_revenue),
        total_bookings: Number(bookingsRow.total_bookings),
        active_stays: Number(activeStaysRow.active_stays),
        arrivals_today: Number(arrivalsRow.arrivals_today),
        departures_today: Number(departuresRow.departures_today),
        total_rooms: totalRooms,
        available_rooms: Number(roomsRow.available_rooms),
        occupied_rooms: occupiedRooms,
        cleaning_rooms: Number(roomsRow.cleaning_rooms),
        maintenance_rooms: Number(roomsRow.maintenance_rooms),
        total_guests: Number(guestsRow.total_guests),
        occupancy_rate: Number(occupancyRate)
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: formatDbError(err) });
  }
});

// Dynamic universal search using raw SQL LIKE on the VIEW
app.get('/api/search', async (req, res) => {
  try {
    const query = req.query.q ? `%${req.query.q.trim()}%` : '%';
    const sql = `
      SELECT * FROM Booking_Details_View
      WHERE guest_name LIKE ?
         OR guest_email LIKE ?
         OR guest_phone LIKE ?
         OR room_number LIKE ?
         OR booking_status LIKE ?
         OR id_proof_number LIKE ?
      ORDER BY booking_id DESC
    `;
    const [rows] = await pool.query(sql, [query, query, query, query, query, query]);
    res.json({ success: true, data: rows });
  } catch (err) {
    res.status(500).json({ success: false, error: formatDbError(err) });
  }
});

// ----------------------------------------------------
// 2. ROOMS CRUD & DATE AVAILABILITY
// ----------------------------------------------------

// Date-Range Room Availability Check
// Returns rooms that do NOT have overlapping active bookings and are NOT in Maintenance
app.get('/api/rooms/available', async (req, res) => {
  try {
    const { check_in, check_out, type, guests } = req.query;

    if (!check_in || !check_out) {
      return res.status(400).json({ success: false, error: 'Both check_in and check_out dates are required.' });
    }

    const checkIn = new Date(check_in);
    const checkOut = new Date(check_out);
    const nights = Math.ceil((checkOut.getTime() - checkIn.getTime()) / (1000 * 3600 * 24));

    if (nights <= 0) {
      return res.status(400).json({ success: false, error: 'Check-out date must be after check-in date.' });
    }

    let sql = `
      SELECT r.* 
      FROM Rooms r
      WHERE r.status != 'Maintenance'
        AND NOT EXISTS (
          SELECT 1 FROM Bookings b
          WHERE b.room_id = r.room_id
            AND b.booking_status IN ('Reserved', 'Confirmed', 'Checked_In')
            AND b.check_in_date < ?
            AND b.check_out_date > ?
        )
    `;
    const params = [check_out, check_in];

    if (type && type !== 'All') {
      sql += ' AND r.room_type = ?';
      params.push(type);
    }
    if (guests && Number(guests) > 0) {
      sql += ' AND r.max_occupancy >= ?';
      params.push(Number(guests));
    }

    sql += ' ORDER BY CAST(r.room_number AS UNSIGNED), r.room_number ASC';

    const [rows] = await pool.query(sql, params);
    
    // Attach calculated total for each room
    const roomsWithPricing = rows.map(r => ({
      ...r,
      nights,
      calculated_total: nights * Number(r.price_per_night)
    }));

    res.json({ success: true, data: roomsWithPricing, nights });
  } catch (err) {
    res.status(500).json({ success: false, error: formatDbError(err) });
  }
});

// List rooms with optional filters
app.get('/api/rooms', async (req, res) => {
  try {
    const { type, status } = req.query;
    let sql = 'SELECT * FROM Rooms WHERE 1=1';
    const params = [];

    if (type && type !== 'All') {
      sql += ' AND room_type = ?';
      params.push(type);
    }
    if (status && status !== 'All') {
      sql += ' AND status = ?';
      params.push(status);
    }

    sql += ' ORDER BY CAST(room_number AS UNSIGNED), room_number ASC';
    const [rows] = await pool.query(sql, params);
    res.json({ success: true, data: rows });
  } catch (err) {
    res.status(500).json({ success: false, error: formatDbError(err) });
  }
});

// Create Room
app.post('/api/rooms', async (req, res) => {
  try {
    const { room_number, room_type, price_per_night, max_occupancy = 2, status = 'Available' } = req.body;
    if (!room_number || !room_type || !price_per_night) {
      return res.status(400).json({ success: false, error: 'Room number, type, and price per night are required.' });
    }

    const sql = `
      INSERT INTO Rooms (room_number, room_type, price_per_night, max_occupancy, status)
      VALUES (?, ?, ?, ?, ?)
    `;
    const [result] = await pool.query(sql, [
      String(room_number).trim(),
      room_type,
      Number(price_per_night),
      Number(max_occupancy) || (room_type === 'Single' ? 1 : room_type === 'Double' ? 2 : 4),
      status
    ]);

    res.status(201).json({
      success: true,
      message: `Room #${room_number} added successfully!`,
      roomId: result.insertId
    });
  } catch (err) {
    res.status(400).json({ success: false, error: formatDbError(err) });
  }
});

// Update Room (Protected against active stay conflicts)
app.put('/api/rooms/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { room_number, room_type, price_per_night, max_occupancy, status } = req.body;

    // Check if room has an ongoing active Checked_In stay right now
    const [[activeStay]] = await pool.query(`
      SELECT b.booking_id, g.full_name
      FROM Bookings b
      JOIN Guests g ON b.guest_id = g.guest_id
      WHERE b.room_id = ?
        AND b.booking_status = 'Checked_In'
      LIMIT 1
    `, [id]);

    if (activeStay && status && status !== 'Occupied') {
      return res.status(400).json({
        success: false,
        error: `Integrity Conflict: Room currently has an active Checked-In guest (${activeStay.full_name}, Booking #${activeStay.booking_id}). Check out the guest before changing room status to '${status}'.`
      });
    }

    // Check if changing to Maintenance while future reservations exist
    if (status === 'Maintenance') {
      const [[upcomingBooking]] = await pool.query(`
        SELECT booking_id, check_in_date, check_out_date
        FROM Bookings
        WHERE room_id = ?
          AND booking_status IN ('Reserved', 'Confirmed')
          AND check_out_date >= CURDATE()
        LIMIT 1
      `, [id]);

      if (upcomingBooking) {
        return res.status(400).json({
          success: false,
          error: `Cannot place room under Maintenance: Room has upcoming reservation #${upcomingBooking.booking_id} from ${upcomingBooking.check_in_date} to ${upcomingBooking.check_out_date}. Please reassign or cancel that reservation first.`
        });
      }
    }

    const sql = `
      UPDATE Rooms
      SET room_number = ?, room_type = ?, price_per_night = ?, max_occupancy = ?, status = ?
      WHERE room_id = ?
    `;
    const [result] = await pool.query(sql, [
      String(room_number).trim(),
      room_type,
      Number(price_per_night),
      Number(max_occupancy) || (room_type === 'Single' ? 1 : room_type === 'Double' ? 2 : 4),
      status,
      id
    ]);

    if (result.affectedRows === 0) {
      return res.status(404).json({ success: false, error: 'Room not found.' });
    }
    res.json({ success: true, message: `Room updated successfully.` });
  } catch (err) {
    res.status(400).json({ success: false, error: formatDbError(err) });
  }
});

// Housekeeping Action: Mark room as cleaned (transitions Cleaning -> Available)
app.put('/api/rooms/:id/clean', async (req, res) => {
  try {
    const { id } = req.params;
    const [[room]] = await pool.query('SELECT * FROM Rooms WHERE room_id = ?', [id]);
    if (!room) {
      return res.status(404).json({ success: false, error: 'Room not found.' });
    }

    if (room.status === 'Occupied') {
      return res.status(400).json({ success: false, error: 'Room is currently occupied by a guest.' });
    }

    await pool.query("UPDATE Rooms SET status = 'Available' WHERE room_id = ?", [id]);
    res.json({ success: true, message: `Room #${room.room_number} is now clean and marked Available for guests.` });
  } catch (err) {
    res.status(400).json({ success: false, error: formatDbError(err) });
  }
});

// Delete Room (Protected from deleting rooms with active/upcoming bookings)
app.delete('/api/rooms/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    // Check for active or upcoming bookings
    const [activeBookings] = await pool.query(`
      SELECT booking_id, booking_status, check_in_date, check_out_date 
      FROM Bookings 
      WHERE room_id = ? AND booking_status IN ('Reserved', 'Confirmed', 'Checked_In')
    `, [id]);

    if (activeBookings.length > 0) {
      return res.status(400).json({
        success: false,
        error: `Relational Protection: Cannot delete this room because it has ${activeBookings.length} active/upcoming reservation(s). Cancel or reassign those bookings first.`
      });
    }

    const [result] = await pool.query('DELETE FROM Rooms WHERE room_id = ?', [id]);
    if (result.affectedRows === 0) {
      return res.status(404).json({ success: false, error: 'Room not found.' });
    }
    res.json({ success: true, message: 'Room deleted successfully.' });
  } catch (err) {
    res.status(400).json({ success: false, error: formatDbError(err) });
  }
});

// ----------------------------------------------------
// 3. GUESTS CRUD & BOOKING HISTORY
// ----------------------------------------------------
app.get('/api/guests', async (req, res) => {
  try {
    const { search } = req.query;
    let sql = 'SELECT * FROM Guests';
    const params = [];

    if (search && search.trim() !== '') {
      sql += ' WHERE full_name LIKE ? OR email LIKE ? OR phone LIKE ? OR id_proof_number LIKE ?';
      const term = `%${search.trim()}%`;
      params.push(term, term, term, term);
    }

    sql += ' ORDER BY guest_id DESC';
    const [rows] = await pool.query(sql, params);
    res.json({ success: true, data: rows });
  } catch (err) {
    res.status(500).json({ success: false, error: formatDbError(err) });
  }
});

// Guest Booking History
app.get('/api/guests/:id/bookings', async (req, res) => {
  try {
    const { id } = req.params;
    const [bookings] = await pool.query(`
      SELECT * FROM Booking_Details_View
      WHERE guest_id = ?
      ORDER BY booking_id DESC
    `, [id]);
    res.json({ success: true, data: bookings });
  } catch (err) {
    res.status(500).json({ success: false, error: formatDbError(err) });
  }
});

app.post('/api/guests', async (req, res) => {
  try {
    const { full_name, email, phone, id_proof_number } = req.body;
    if (!full_name || !email || !phone || !id_proof_number) {
      return res.status(400).json({ success: false, error: 'All guest profile fields are mandatory.' });
    }

    const sql = `
      INSERT INTO Guests (full_name, email, phone, id_proof_number)
      VALUES (?, ?, ?, ?)
    `;
    const [result] = await pool.query(sql, [
      full_name.trim(),
      email.trim(),
      phone.trim(),
      id_proof_number.trim()
    ]);

    res.status(201).json({
      success: true,
      message: `Guest ${full_name} registered successfully!`,
      guestId: result.insertId
    });
  } catch (err) {
    res.status(400).json({ success: false, error: formatDbError(err) });
  }
});

app.put('/api/guests/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { full_name, email, phone, id_proof_number } = req.body;

    const sql = `
      UPDATE Guests
      SET full_name = ?, email = ?, phone = ?, id_proof_number = ?
      WHERE guest_id = ?
    `;
    const [result] = await pool.query(sql, [
      full_name.trim(),
      email.trim(),
      phone.trim(),
      id_proof_number.trim(),
      id
    ]);

    if (result.affectedRows === 0) {
      return res.status(404).json({ success: false, error: 'Guest not found.' });
    }
    res.json({ success: true, message: 'Guest updated successfully.' });
  } catch (err) {
    res.status(400).json({ success: false, error: formatDbError(err) });
  }
});

// Delete Guest (Protected from deleting guests with active/upcoming stays)
app.delete('/api/guests/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const [activeBookings] = await pool.query(`
      SELECT booking_id 
      FROM Bookings 
      WHERE guest_id = ? AND booking_status IN ('Reserved', 'Confirmed', 'Checked_In')
    `, [id]);

    if (activeBookings.length > 0) {
      return res.status(400).json({
        success: false,
        error: `Relational Protection: Cannot delete this guest profile because they have ${activeBookings.length} active or upcoming reservation(s).`
      });
    }

    const [result] = await pool.query('DELETE FROM Guests WHERE guest_id = ?', [id]);
    if (result.affectedRows === 0) {
      return res.status(404).json({ success: false, error: 'Guest not found.' });
    }
    res.json({ success: true, message: 'Guest record removed successfully.' });
  } catch (err) {
    res.status(400).json({ success: false, error: formatDbError(err) });
  }
});

// ----------------------------------------------------
// 4. BOOKINGS & PAYMENTS CRUD (Transactions & SQL View)
// ----------------------------------------------------
app.get('/api/bookings', async (req, res) => {
  try {
    const { status, search } = req.query;
    let sql = 'SELECT * FROM Booking_Details_View WHERE 1=1';
    const params = [];

    if (status && status !== 'All') {
      sql += ' AND booking_status = ?';
      params.push(status);
    }
    if (search && search.trim() !== '') {
      sql += ' AND (guest_name LIKE ? OR room_number LIKE ? OR guest_phone LIKE ?)';
      const term = `%${search.trim()}%`;
      params.push(term, term, term);
    }

    sql += ' ORDER BY booking_id DESC';
    const [rows] = await pool.query(sql, params);
    res.json({ success: true, data: rows });
  } catch (err) {
    res.status(500).json({ success: false, error: formatDbError(err) });
  }
});

// Create Booking with Atomic SQL Transaction, Row Locking & Overlap Detection
app.post('/api/bookings', async (req, res) => {
  const connection = await pool.getConnection();
  try {
    const { 
      guest_id, 
      room_id, 
      check_in_date, 
      check_out_date, 
      payment_method, 
      num_guests = 1,
      booking_type = 'Confirmed' // 'Confirmed' or 'Checked_In' (walk-in)
    } = req.body;

    if (!guest_id || !room_id || !check_in_date || !check_out_date || !payment_method) {
      return res.status(400).json({ success: false, error: 'All booking fields are required.' });
    }

    const checkIn = new Date(check_in_date);
    const checkOut = new Date(check_out_date);
    const timeDiff = checkOut.getTime() - checkIn.getTime();
    const nights = Math.ceil(timeDiff / (1000 * 3600 * 24));

    if (nights <= 0) {
      return res.status(400).json({ success: false, error: 'Check-out date must be strictly after check-in date.' });
    }

    // Begin Database Transaction for ACID guarantees
    await connection.beginTransaction();

    // 1. Lock room row with FOR UPDATE for concurrency protection
    const [[room]] = await connection.query('SELECT * FROM Rooms WHERE room_id = ? FOR UPDATE', [room_id]);
    if (!room) {
      await connection.rollback();
      return res.status(404).json({ success: false, error: 'Selected room not found.' });
    }

    if (room.status === 'Maintenance') {
      await connection.rollback();
      return res.status(400).json({ success: false, error: `Room #${room.room_number} is currently under Maintenance and cannot be booked.` });
    }

    // Capacity Check
    const guestCount = Number(num_guests) || 1;
    if (guestCount > room.max_occupancy) {
      await connection.rollback();
      return res.status(400).json({ 
        success: false, 
        error: `Occupancy Limit: Room #${room.room_number} (${room.room_type}) only accommodates up to ${room.max_occupancy} guests (requested: ${guestCount}).` 
      });
    }

    // 2. Strict Overlapping Booking Detection with FOR UPDATE
    const [conflicts] = await connection.query(`
      SELECT booking_id, check_in_date, check_out_date, booking_status
      FROM Bookings
      WHERE room_id = ?
        AND booking_status IN ('Reserved', 'Confirmed', 'Checked_In')
        AND check_in_date < ?
        AND check_out_date > ?
      FOR UPDATE
    `, [room_id, check_out_date, check_in_date]);

    if (conflicts.length > 0) {
      await connection.rollback();
      const conflict = conflicts[0];
      return res.status(409).json({
        success: false,
        error: `Double-Booking Conflict: Room #${room.room_number} is already booked (Booking #${conflict.booking_id}: ${conflict.check_in_date} to ${conflict.check_out_date}, Status: ${conflict.booking_status}). Please select another room or different dates.`
      });
    }

    const totalAmount = nights * Number(room.price_per_night);

    // Initial booking status determination
    const finalBookingStatus = ['Reserved', 'Confirmed', 'Checked_In'].includes(booking_type) ? booking_type : 'Confirmed';

    // 3. Insert Booking (Trigger will auto-set Rooms.status = 'Occupied' if Checked_In or today's stay)
    const [bookingResult] = await connection.query(
      `INSERT INTO Bookings (guest_id, room_id, num_guests, check_in_date, check_out_date, total_amount, booking_status)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [guest_id, room_id, guestCount, check_in_date, check_out_date, totalAmount, finalBookingStatus]
    );

    const bookingId = bookingResult.insertId;

    // 4. Insert Payment Record
    await connection.query(
      `INSERT INTO Payments (booking_id, amount_paid, payment_method)
       VALUES (?, ?, ?)`,
      [bookingId, totalAmount, payment_method]
    );

    // Commit Transaction
    await connection.commit();

    res.status(201).json({
      success: true,
      message: `Reservation #${bookingId} confirmed! Room #${room.room_number} booked for ${nights} night(s).`,
      bookingId,
      totalAmount,
      nights
    });
  } catch (err) {
    await connection.rollback();
    res.status(400).json({ success: false, error: formatDbError(err) });
  } finally {
    connection.release();
  }
});

// Update Booking Status (Check In / Check Out / Cancel - fires SQL Trigger)
app.put('/api/bookings/:id/status', async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    if (!['Reserved', 'Confirmed', 'Checked_In', 'Checked_Out', 'Cancelled'].includes(status)) {
      return res.status(400).json({ success: false, error: 'Invalid booking status.' });
    }

    const [[booking]] = await pool.query('SELECT * FROM Bookings WHERE booking_id = ?', [id]);
    if (!booking) {
      return res.status(404).json({ success: false, error: 'Booking record not found.' });
    }

    // State transition validations
    if (status === 'Checked_In') {
      if (['Checked_Out', 'Cancelled'].includes(booking.booking_status)) {
        return res.status(400).json({ success: false, error: `Cannot check in a booking that is already ${booking.booking_status}.` });
      }
    }

    const [result] = await pool.query(
      `UPDATE Bookings SET booking_status = ? WHERE booking_id = ?`,
      [status, id]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ success: false, error: 'Booking record not found.' });
    }

    let statusDesc = `Booking #${id} status changed to '${status}'.`;
    if (status === 'Checked_Out') {
      statusDesc += ' Guest checked out successfully; room is now assigned to Housekeeping (Cleaning).';
    } else if (status === 'Checked_In') {
      statusDesc += ' Guest checked in; room is now marked Occupied.';
    }

    res.json({
      success: true,
      message: statusDesc
    });
  } catch (err) {
    res.status(400).json({ success: false, error: formatDbError(err) });
  }
});

// Delete Booking (Protected from deleting active checked-in stays)
app.delete('/api/bookings/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    const [[booking]] = await pool.query('SELECT * FROM Bookings WHERE booking_id = ?', [id]);
    if (!booking) {
      return res.status(404).json({ success: false, error: 'Booking record not found.' });
    }

    if (booking.booking_status === 'Checked_In') {
      return res.status(400).json({ 
        success: false, 
        error: 'Integrity Protection: Cannot delete an active Checked-In stay. Please complete Check-Out or Cancel before deletion.' 
      });
    }

    const [result] = await pool.query(`DELETE FROM Bookings WHERE booking_id = ?`, [id]);
    if (result.affectedRows === 0) {
      return res.status(404).json({ success: false, error: 'Booking record not found.' });
    }
    res.json({ success: true, message: 'Booking deleted successfully.' });
  } catch (err) {
    res.status(400).json({ success: false, error: formatDbError(err) });
  }
});

// Get all Payments (Direct Table Read for Live DB Preview)
app.get('/api/payments', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT payment_id, booking_id, amount_paid, payment_method, payment_date FROM Payments ORDER BY payment_id DESC');
    res.json({ success: true, data: rows });
  } catch (err) {
    res.status(500).json({ success: false, error: formatDbError(err) });
  }
});

// Start Server
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`=======================================================`);
    console.log(`🏨 Hotel Management System Server listening on port ${PORT}`);
    console.log(`👉 Open http://localhost:${PORT} in your browser`);
    console.log(`=======================================================`);

    // Auto-launch MySQL Workbench on startup (Local Windows environment)
    if (process.env.NODE_ENV !== 'production' && process.platform === 'win32') {
      const fs = require('fs');
      const { exec } = require('child_process');
      const workbenchPath = 'C:\\Program Files\\MySQL\\MySQL Workbench 8.0\\MySQLWorkbench.exe';
      if (fs.existsSync(workbenchPath)) {
        exec('tasklist /FI "IMAGENAME eq MySQLWorkbench.exe"', (err, stdout) => {
          if (!err && stdout && !stdout.includes('MySQLWorkbench.exe')) {
            exec(`start "" "${workbenchPath}"`, (launchErr) => {
              if (!launchErr) {
                console.log(`🐬 MySQL Workbench launched automatically (Default Schema: hotel_db)`);
              }
            });
          }
        });
      }
    }
  });
}

module.exports = app;
