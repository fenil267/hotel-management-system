-- ========================================================
-- Hotel Management System Database Schema (hotel_db)
-- Designed for DBMS Course Project (Normalized 3NF Schema)
-- ========================================================

DROP DATABASE IF EXISTS hotel_db;
CREATE DATABASE hotel_db CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE hotel_db;

-- --------------------------------------------------------
-- 1. Rooms Table
-- --------------------------------------------------------
CREATE TABLE Rooms (
    room_id INT AUTO_INCREMENT PRIMARY KEY,
    room_number VARCHAR(20) NOT NULL UNIQUE,
    room_type ENUM('Single', 'Double', 'Suite') NOT NULL,
    price_per_night DECIMAL(10, 2) NOT NULL,
    max_occupancy INT NOT NULL DEFAULT 2,
    status ENUM('Available', 'Occupied', 'Cleaning', 'Maintenance') NOT NULL DEFAULT 'Available',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT chk_room_price CHECK (price_per_night > 0),
    CONSTRAINT chk_max_occupancy CHECK (max_occupancy > 0)
) ENGINE=InnoDB;

-- --------------------------------------------------------
-- 2. Guests Table
-- --------------------------------------------------------
CREATE TABLE Guests (
    guest_id INT AUTO_INCREMENT PRIMARY KEY,
    full_name VARCHAR(100) NOT NULL,
    email VARCHAR(100) NOT NULL UNIQUE,
    phone VARCHAR(20) NOT NULL,
    id_proof_number VARCHAR(50) NOT NULL UNIQUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

-- --------------------------------------------------------
-- 3. Bookings Table
-- --------------------------------------------------------
CREATE TABLE Bookings (
    booking_id INT AUTO_INCREMENT PRIMARY KEY,
    guest_id INT NOT NULL,
    room_id INT NOT NULL,
    num_guests INT NOT NULL DEFAULT 1,
    check_in_date DATE NOT NULL,
    check_out_date DATE NOT NULL,
    total_amount DECIMAL(10, 2) NOT NULL,
    booking_status ENUM('Reserved', 'Confirmed', 'Checked_In', 'Checked_Out', 'Cancelled') NOT NULL DEFAULT 'Confirmed',
    booking_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (guest_id) REFERENCES Guests(guest_id) ON DELETE CASCADE,
    FOREIGN KEY (room_id) REFERENCES Rooms(room_id) ON DELETE CASCADE,
    CONSTRAINT chk_booking_dates CHECK (check_out_date > check_in_date),
    CONSTRAINT chk_total_amount CHECK (total_amount >= 0),
    CONSTRAINT chk_num_guests CHECK (num_guests > 0)
) ENGINE=InnoDB;

-- --------------------------------------------------------
-- 4. Payments Table
-- --------------------------------------------------------
CREATE TABLE Payments (
    payment_id INT AUTO_INCREMENT PRIMARY KEY,
    booking_id INT NOT NULL,
    amount_paid DECIMAL(10, 2) NOT NULL,
    payment_method ENUM('Cash', 'Card', 'UPI') NOT NULL,
    payment_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (booking_id) REFERENCES Bookings(booking_id) ON DELETE CASCADE,
    CONSTRAINT chk_amount_paid CHECK (amount_paid >= 0)
) ENGINE=InnoDB;

-- --------------------------------------------------------
-- TRIGGERS: Automated Room Status Synchronization
-- --------------------------------------------------------
DELIMITER $$


-- Trigger 1: On Booking Insert
-- If booking is directly Checked_In (or Confirmed for today), mark room Occupied.
-- Future reservations leave the room available for current operations.
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
-- Cancelled -> If room was Occupied by this booking, return to 'Available'
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

-- --------------------------------------------------------
-- VIEW: Complete Booking & Payment Details
-- --------------------------------------------------------
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

-- --------------------------------------------------------
-- Starter Sample Data (Optional verification records)
-- --------------------------------------------------------
INSERT INTO Rooms (room_number, room_type, price_per_night, max_occupancy, status) VALUES
('101', 'Single', 1200.00, 1, 'Available'),
('102', 'Single', 1200.00, 1, 'Available'),
('201', 'Double', 2200.00, 2, 'Available'),
('202', 'Double', 2400.00, 2, 'Cleaning'),
('301', 'Suite', 4500.00, 4, 'Available'),
('302', 'Suite', 5000.00, 4, 'Maintenance');

INSERT INTO Guests (full_name, email, phone, id_proof_number) VALUES
('Aarav Sharma', 'aarav.sharma@example.com', '+91 9876543210', 'AADHAAR-8832-1102'),
('Ananya Patel', 'ananya.patel@example.com', '+91 9822334455', 'PASSPORT-Z992182'),
('Rohan Verma', 'rohan.verma@example.com', '+91 9711223344', 'PAN-ABCDE1234F');

-- Sample confirmed stay
INSERT INTO Bookings (guest_id, room_id, num_guests, check_in_date, check_out_date, total_amount, booking_status) VALUES
(1, 3, 2, CURDATE(), DATE_ADD(CURDATE(), INTERVAL 2 DAY), 4400.00, 'Checked_In');

INSERT INTO Payments (booking_id, amount_paid, payment_method) VALUES
(1, 4400.00, 'UPI');
