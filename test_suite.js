const mysql = require('mysql2/promise');
require('dotenv').config();

async function runTests() {
  console.log('=======================================================');
  console.log('🧪 RUNNING HOTEL MANAGEMENT SYSTEM VERIFICATION TEST SUITE');
  console.log('=======================================================');

  const pool = mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    port: Number(process.env.DB_PORT) || 3306,
    dateStrings: true
  });

  const baseUrl = `http://localhost:${process.env.PORT || 3000}`;

  let passed = 0;
  let failed = 0;

  function assert(condition, message) {
    if (condition) {
      console.log(`  ✅ PASS: ${message}`);
      passed++;
    } else {
      console.error(`  ❌ FAIL: ${message}`);
      failed++;
    }
  }

  try {
    // 1. Health check
    const healthRes = await fetch(`${baseUrl}/api/health`);
    const healthData = await healthRes.json();
    assert(healthData.success && healthData.db_connected === true, 'GET /api/health reports real DB connection status');

    // 2. Clear out any previous test bookings/guests/rooms with test prefix
    await pool.query("DELETE FROM Bookings WHERE guest_id IN (SELECT guest_id FROM Guests WHERE email LIKE 'test_%@example.com')");
    await pool.query("DELETE FROM Guests WHERE email LIKE 'test_%@example.com'");
    await pool.query("DELETE FROM Rooms WHERE room_number LIKE 'TEST-%'");

    // Create a test guest
    const [gResult] = await pool.query(
      "INSERT INTO Guests (full_name, email, phone, id_proof_number) VALUES ('Test Guest', 'test_user1@example.com', '1234567890', 'TEST-ID-001')"
    );
    const guestId = gResult.insertId;

    // Create a test room
    const [rResult] = await pool.query(
      "INSERT INTO Rooms (room_number, room_type, price_per_night, max_occupancy, status) VALUES ('TEST-101', 'Double', 2000.00, 2, 'Available')"
    );
    const roomId = rResult.insertId;

    // TEST 1: Initial Date Availability
    const availRes1 = await fetch(`${baseUrl}/api/rooms/available?check_in=2026-11-01&check_out=2026-11-05`);
    const availData1 = await availRes1.json();
    const hasRoom1 = availData1.data && availData1.data.some(r => r.room_id === roomId);
    assert(hasRoom1, 'TEST-101 is initially available for 2026-11-01 to 2026-11-05');

    // TEST 2: Successful Booking for 2026-11-01 to 2026-11-05
    const bookRes1 = await fetch(`${baseUrl}/api/bookings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        guest_id: guestId,
        room_id: roomId,
        check_in_date: '2026-11-01',
        check_out_date: '2026-11-05',
        payment_method: 'UPI',
        num_guests: 2
      })
    });
    const bookData1 = await bookRes1.json();
    assert(bookData1.success === true && bookData1.bookingId, 'Created valid reservation for 2026-11-01 to 2026-11-05');

    // TEST 3: Overlapping Double-Booking Prevention (Subset: 2026-11-02 to 2026-11-04)
    const bookResOverlap = await fetch(`${baseUrl}/api/bookings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        guest_id: guestId,
        room_id: roomId,
        check_in_date: '2026-11-02',
        check_out_date: '2026-11-04',
        payment_method: 'Card',
        num_guests: 1
      })
    });
    const bookDataOverlap = await bookResOverlap.json();
    assert(bookResOverlap.status === 409 && bookDataOverlap.success === false, 'Overlapping booking blocked with 409 Conflict: ' + bookDataOverlap.error);

    // TEST 4: Adjacent Non-Overlapping Booking (starts on check_out date: 2026-11-05 to 2026-11-08)
    const bookResAdjacent = await fetch(`${baseUrl}/api/bookings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        guest_id: guestId,
        room_id: roomId,
        check_in_date: '2026-11-05',
        check_out_date: '2026-11-08',
        payment_method: 'Cash',
        num_guests: 1
      })
    });
    const bookDataAdjacent = await bookResAdjacent.json();
    assert(bookDataAdjacent.success === true, 'Adjacent booking (2026-11-05 to 2026-11-08) succeeded without conflict');

    // TEST 5: Invalid Date Validation (Checkout before Checkin)
    const bookResInvalidDates = await fetch(`${baseUrl}/api/bookings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        guest_id: guestId,
        room_id: roomId,
        check_in_date: '2026-11-10',
        check_out_date: '2026-11-09',
        payment_method: 'Card'
      })
    });
    const bookDataInvalidDates = await bookResInvalidDates.json();
    assert(bookResInvalidDates.status === 400 && bookDataInvalidDates.success === false, 'Invalid dates (check-out <= check-in) rejected with 400');

    // TEST 6: Room Capacity Enforcement
    const bookResOverCapacity = await fetch(`${baseUrl}/api/bookings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        guest_id: guestId,
        room_id: roomId,
        check_in_date: '2026-11-20',
        check_out_date: '2026-11-22',
        payment_method: 'UPI',
        num_guests: 5 // Room capacity is 2
      })
    });
    const bookDataOverCapacity = await bookResOverCapacity.json();
    assert(bookResOverCapacity.status === 400 && bookDataOverCapacity.error.includes('Occupancy Limit'), 'Booking exceeding room capacity was blocked');

    // TEST 7: Housekeeping Lifecycle: Check-In -> Check-Out -> Cleaning -> Cleaned (Available)
    const [todayRoom] = await pool.query(
      "INSERT INTO Rooms (room_number, room_type, price_per_night, max_occupancy, status) VALUES ('TEST-102', 'Single', 1500.00, 1, 'Available')"
    );
    const todayRoomId = todayRoom.insertId;

    const bookToday = await fetch(`${baseUrl}/api/bookings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        guest_id: guestId,
        room_id: todayRoomId,
        check_in_date: new Date().toISOString().split('T')[0],
        check_out_date: new Date(Date.now() + 86400000).toISOString().split('T')[0],
        payment_method: 'UPI',
        booking_type: 'Checked_In' // Immediate check-in
      })
    });
    const bookTodayData = await bookToday.json();
    const todayBookingId = bookTodayData.bookingId;

    // Check room status is now Occupied
    const [[rOccupied]] = await pool.query('SELECT status FROM Rooms WHERE room_id = ?', [todayRoomId]);
    assert(rOccupied.status === 'Occupied', 'Room status transitioned to Occupied on Check-In');

    // Attempt to manually edit room to Available while guest is checked in (should be blocked)
    const editConflict = await fetch(`${baseUrl}/api/rooms/${todayRoomId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        room_number: 'TEST-102',
        room_type: 'Single',
        price_per_night: 1500.00,
        status: 'Available'
      })
    });
    const editConflictData = await editConflict.json();
    assert(editConflict.status === 400 && editConflictData.error.includes('Integrity Conflict'), 'Manual room status change to Available blocked while guest checked in');

    // Now Check Out the guest
    const checkoutRes = await fetch(`${baseUrl}/api/bookings/${todayBookingId}/status`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'Checked_Out' })
    });
    assert(checkoutRes.ok, 'Checked out guest successfully');

    // Verify room is now in 'Cleaning' status (housekeeping)
    const [[rCleaning]] = await pool.query('SELECT status FROM Rooms WHERE room_id = ?', [todayRoomId]);
    assert(rCleaning.status === 'Cleaning', 'Room status transitioned to Cleaning upon Check-Out (Housekeeping workflow)');

    // Housekeeping Action: Clean room
    const cleanRes = await fetch(`${baseUrl}/api/rooms/${todayRoomId}/clean`, { method: 'PUT' });
    const cleanData = await cleanRes.json();
    const [[rCleaned]] = await pool.query('SELECT status FROM Rooms WHERE room_id = ?', [todayRoomId]);
    assert(cleanData.success && rCleaned.status === 'Available', 'Housekeeping /clean action made room Available again');

    // TEST 8: Revenue KPI excludes Cancelled bookings
    // Check initial revenue
    const stats1 = await (await fetch(`${baseUrl}/api/stats`)).json();
    const revBefore = stats1.data.total_revenue;

    // Create a booking and cancel it
    const cancelBooking = await fetch(`${baseUrl}/api/bookings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        guest_id: guestId,
        room_id: roomId,
        check_in_date: '2026-12-01',
        check_out_date: '2026-12-03',
        payment_method: 'Card'
      })
    });
    const cancelData = await cancelBooking.json();
    
    // Revenue after booking
    const stats2 = await (await fetch(`${baseUrl}/api/stats`)).json();
    assert(stats2.data.total_revenue === revBefore + 4000, 'Revenue accurately increased by 4000 after confirmed booking');

    // Now cancel the booking
    await fetch(`${baseUrl}/api/bookings/${cancelData.bookingId}/status`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'Cancelled' })
    });

    // Revenue after cancellation
    const stats3 = await (await fetch(`${baseUrl}/api/stats`)).json();
    assert(stats3.data.total_revenue === revBefore, 'Revenue accurately subtracted 4000 after cancellation (cancelled bookings excluded)');

    // TEST 9: Accidental Deletion Protection
    const delRoomRes = await fetch(`${baseUrl}/api/rooms/${roomId}`, { method: 'DELETE' });
    const delRoomData = await delRoomRes.json();
    assert(delRoomRes.status === 400 && delRoomData.error.includes('Relational Protection'), 'Protected room from deletion because it has active reservations');

    // TEST 10: Concurrency Simulation (Two parallel requests attempting to book same room for same dates)
    const [concRoom] = await pool.query(
      "INSERT INTO Rooms (room_number, room_type, price_per_night, max_occupancy, status) VALUES ('TEST-CONC', 'Single', 1000.00, 1, 'Available')"
    );
    const concRoomId = concRoom.insertId;

    const req1 = fetch(`${baseUrl}/api/bookings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        guest_id: guestId,
        room_id: concRoomId,
        check_in_date: '2026-12-10',
        check_out_date: '2026-12-15',
        payment_method: 'UPI'
      })
    });

    const req2 = fetch(`${baseUrl}/api/bookings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        guest_id: guestId,
        room_id: concRoomId,
        check_in_date: '2026-12-12',
        check_out_date: '2026-12-14',
        payment_method: 'Cash'
      })
    });

    const [res1, res2] = await Promise.all([req1, req2]);
    const data1 = await res1.json();
    const data2 = await res2.json();

    const oneSucceeded = (data1.success && !data2.success) || (!data1.success && data2.success);
    const oneConflict = res1.status === 409 || res2.status === 409;
    assert(oneSucceeded && oneConflict, 'Concurrency test: Exactly one concurrent reservation succeeded and the other received 409 Conflict');

    // Clean up test data
    await pool.query("DELETE FROM Bookings WHERE guest_id = ?", [guestId]);
    await pool.query("DELETE FROM Guests WHERE guest_id = ?", [guestId]);
    await pool.query("DELETE FROM Rooms WHERE room_number LIKE 'TEST-%'");

    console.log('=======================================================');
    console.log(`📊 TEST RESULTS: ${passed} PASSED, ${failed} FAILED`);
    console.log('=======================================================');

    if (failed > 0) {
      process.exit(1);
    }
  } catch (err) {
    console.error('Test execution error:', err);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

runTests();
