-- ========================================================
-- Database Migration for Improved Hotel Management System
-- ========================================================

USE hotel_db;

-- 1. Update Rooms table status to include 'Cleaning' and add max_occupancy
ALTER TABLE Rooms 
    MODIFY COLUMN status ENUM('Available', 'Occupied', 'Cleaning', 'Maintenance') NOT NULL DEFAULT 'Available';

-- Check if max_occupancy column already exists, if not add it
SET @col_exists = (SELECT COUNT(*) FROM information_schema.COLUMNS 
    WHERE TABLE_SCHEMA = 'hotel_db' AND TABLE_NAME = 'Rooms' AND COLUMN_NAME = 'max_occupancy');
SET @sql = IF(@col_exists = 0, 'ALTER TABLE Rooms ADD COLUMN max_occupancy INT NOT NULL DEFAULT 2 AFTER price_per_night', 'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- Update room default occupancies based on type
UPDATE Rooms SET max_occupancy = 1 WHERE room_type = 'Single' AND (max_occupancy IS NULL OR max_occupancy = 2);
UPDATE Rooms SET max_occupancy = 2 WHERE room_type = 'Double';
UPDATE Rooms SET max_occupancy = 4 WHERE room_type = 'Suite';

-- 2. Update Bookings table booking_status to include 'Reserved' and 'Checked_In'
ALTER TABLE Bookings 
    MODIFY COLUMN booking_status ENUM('Reserved', 'Confirmed', 'Checked_In', 'Checked_Out', 'Cancelled') NOT NULL DEFAULT 'Confirmed';

-- Check if num_guests column already exists, if not add it
SET @col_b_exists = (SELECT COUNT(*) FROM information_schema.COLUMNS 
    WHERE TABLE_SCHEMA = 'hotel_db' AND TABLE_NAME = 'Bookings' AND COLUMN_NAME = 'num_guests');
SET @sql_b = IF(@col_b_exists = 0, 'ALTER TABLE Bookings ADD COLUMN num_guests INT NOT NULL DEFAULT 1 AFTER room_id', 'SELECT 1');
PREPARE stmt FROM @sql_b;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 3. Replace Triggers for Realistic Hotel Operations Lifecycle
DROP TRIGGER IF EXISTS trg_after_booking_insert;
DROP TRIGGER IF EXISTS trg_after_booking_update;
DROP TRIGGER IF EXISTS trg_after_booking_delete;

DELIMITER $$

-- Trigger 1: On Booking Insert
-- If booking is directly Checked_In (or Confirmed for today), mark room Occupied.
-- Future reservations ('Reserved' or future 'Confirmed') leave the room in its current state.
CREATE TRIGGER trg_after_booking_insert
AFTER INSERT ON Bookings
FOR EACH ROW
BEGIN
    IF NEW.booking_status = 'Checked_In' OR (NEW.booking_status = 'Confirmed' AND NEW.check_in_date <= CURDATE() AND NEW.check_out_date > CURDATE()) THEN
        UPDATE Rooms
        SET status = 'Occupied'
        WHERE room_id = NEW.room_id;
    END IF;
END$$

-- Trigger 2: On Booking Status Update
-- Checked_In -> Room becomes 'Occupied'
-- Checked_Out -> Room transitions to 'Cleaning' (Housekeeping workflow)
-- Cancelled -> If room was Occupied for this booking, return to 'Available'
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
        -- Only set available if currently occupied by this reservation
        UPDATE Rooms
        SET status = 'Available'
        WHERE room_id = NEW.room_id AND status = 'Occupied';
    END IF;
END$$

-- Trigger 3: On Booking Delete
-- If active stay deleted, release room to Available
CREATE TRIGGER trg_after_booking_delete
AFTER DELETE ON Bookings
FOR EACH ROW
BEGIN
    IF OLD.booking_status IN ('Checked_In', 'Confirmed') THEN
        UPDATE Rooms
        SET status = 'Available'
        WHERE room_id = OLD.room_id AND status = 'Occupied';
    END IF;
END$$

DELIMITER ;

-- 4. Recreate View with additional fields
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
LEFT JOIN Payments p ON b.booking_id = p.booking_id;
