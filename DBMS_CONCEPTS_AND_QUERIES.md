# Comprehensive DBMS Concepts and SQL Query Reference Guide
**Project:** Hotel Management System (`hotel_db`)  
**Technology:** MySQL 8.0+ (InnoDB Storage Engine) / Node.js Express Client

---

## Table of Contents
1. [Architectural Overview & Relational Modeling](#1-architectural-overview--relational-modeling)
2. [Database Normalization Analysis (1NF to BCNF)](#2-database-normalization-analysis-1nf-to-bcnf)
3. [Data Definition Language (DDL) & Schema Architecture](#3-data-definition-language-ddl--schema-architecture)
4. [Relational Integrity & Domain Constraints](#4-relational-integrity--domain-constraints)
5. [Data Query Language (DQL) & Relational Algebra](#5-data-query-language-dql--relational-algebra)
6. [Database Views & Logical Data Independence](#6-database-views--logical-data-independence)
7. [Active Database Rules: Triggers & State Machines](#7-active-database-rules-triggers--state-machines)
8. [Transactions & ACID Concurrency Control](#8-transactions--acid-concurrency-control)
9. [Relational Error Codes & Integrity Violation Handling](#9-relational-error-codes--integrity-violation-handling)
10. [Exhaustive Catalogue of All Project Queries](#10-exhaustive-catalogue-of-all-project-queries)

---

## 1. Architectural Overview & Relational Modeling

In database management systems (DBMS), a **relational database** organizes data into one or more tables (relations) of columns and rows, with a unique key identifying each row. The mathematical foundation rests upon First-Order Predicate Logic and Relational Algebra defined by Edgar F. Codd.

### Entity-Relationship (ER) Abstraction
The system models the hospitality enterprise through four core entities:
1. **Room (`Rooms`):** Physical rentable real-estate inventory possessing constraints on pricing, classification, occupancy capacity, and operational cleanliness states.
2. **Guest (`Guests`):** Legal human patrons possessing government-verified unique identifiers, communication vectors, and contact indices.
3. **Booking (`Bookings`):** Relational transaction linking a `Guest` to a `Room` over an immutable closed-open date interval $[T_{\text{checkin}}, T_{\text{checkout}})$.
4. **Payment (`Payments`):** Financial remittance entity securing monetary reconciliation for a specific `Booking`.

```
+---------------+              1 : N              +-----------------+
|    Guests     | ------------------------------> |    Bookings     |
+---------------+                                 +-----------------+
| PK: guest_id  |                                 | PK: booking_id  |
| UK: email     |                                 | FK: guest_id    |
| UK: id_proof  |                                 | FK: room_id     |
+---------------+                                 +-----------------+
                                                          | 1
                                                          | :
                                                          | N
                                                  +-----------------+
                                                  |    Payments     |
                                                  +-----------------+
                                                  | PK: payment_id  |
                                                  | FK: booking_id  |
                                                  +-----------------+
                                                          |
                                                  N : 1   |
                                                  +-----------------+
                                                  |     Rooms       |
                                                  +-----------------+
                                                  | PK: room_id     |
                                                  | UK: room_number |
                                                  +-----------------+
```

---

## 2. Database Normalization Analysis (1NF to BCNF)

Normalization is the systematic process of decomposing tables to minimize data redundancy and eliminate relational anomalies (Insertion, Update, and Deletion anomalies).

### 2.1 First Normal Form (1NF)
**Theoretical Rule:**
- Every attribute contains only atomic (indivisible) values.
- There are no repeating groups or multivalued attributes.
- Each tuple is distinct, guaranteed by a primary key.

**Implementation Proof:**
- In `Guests`, contact numbers and names are stored in discrete scalar attributes (`full_name`, `phone`, `email`), not nested comma-delimited arrays.
- In `Bookings`, individual stay intervals and guest counts are strictly atomic scalars.

### 2.2 Second Normal Form (2NF)
**Theoretical Rule:**
- The relation must be in 1NF.
- No non-prime attribute is partially dependent on any candidate key (requires eradication of partial functional dependencies).

**Implementation Proof:**
- All primary keys in `hotel_db` are simple single-attribute surrogate keys (`room_id`, `guest_id`, `booking_id`, `payment_id`).
- Since no composite candidate key exists, partial functional dependency is mathematically impossible; thus, the schema satisfies 2NF trivially.

### 2.3 Third Normal Form (3NF)
**Theoretical Rule:**
- The relation must be in 2NF.
- No non-prime attribute is transitively dependent on the primary key ($X \to Y$ and $Y \to Z$ where $Z$ is non-prime).

**Implementation Proof:**
- **Counter-scenario avoided:** If `Bookings` stored `guest_name`, `guest_email`, and `room_price_per_night`, then:
  $$\text{booking\_id} \to \text{guest\_id} \to \text{guest\_name}$$
  $$\text{booking\_id} \to \text{room\_id} \to \text{price\_per\_night}$$
  This would introduce transitive dependencies.
- **Normalized state:** `Bookings` retains solely `guest_id` and `room_id` as Foreign Keys. All guest profile data is decoupled into `Guests`, and room tariff parameters reside strictly in `Rooms`.
- Transitive dependencies are 100% eliminated, satisfying 3NF.

### 2.4 Boyce-Codd Normal Form (BCNF)
**Theoretical Rule:**
- A relation is in BCNF if and only if for every functional dependency $X \to Y$, $X$ is a superkey.

**Implementation Proof:**
- In `Guests`, dependencies are:
  $$\text{guest\_id} \to \{\text{full\_name}, \text{phone}, \text{email}, \text{id\_proof\_number}\}$$
  $$\text{email} \to \{\text{guest\_id}, \text{full\_name}, \text{phone}, \text{id\_proof\_number}\}$$
  $$\text{id\_proof\_number} \to \{\text{guest\_id}, \text{full\_name}, \text{phone}, \text{email}\}$$
  In each dependency, the determinant ($X$) is a candidate key / superkey enforced via `UNIQUE` constraints.
- Hence, the schema conforms to BCNF.

---

## 3. Data Definition Language (DDL) & Schema Architecture

DDL statements create and modify schema structures within the MySQL catalog (`information_schema`).

```sql
DROP DATABASE IF EXISTS hotel_db;
CREATE DATABASE hotel_db CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE hotel_db;
```
- **`utf8mb4`:** UTF-8 encoding supporting full 4-byte Unicode characters (international guest names, accents, symbols).
- **`utf8mb4_unicode_ci`:** Case-insensitive, UCA (Unicode Collation Algorithm) compliant sorting.

---

### 3.1 Table: `Rooms`
```sql
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
```
- **`ENGINE=InnoDB`:** Mandates MySQL's ACID-compliant transactional storage engine supporting row-level locking, foreign keys, and crash recovery via redo/undo logs.
- **`DECIMAL(10, 2)`:** Fixed-point representation. Eliminates floating-point IEEE 754 precision inaccuracies in financial accounting.
- **`ENUM`:** Internally stored as 1-byte integer offsets; restricts domain values to permissible finite state machines.

---

### 3.2 Table: `Guests`
```sql
CREATE TABLE Guests (
    guest_id INT AUTO_INCREMENT PRIMARY KEY,
    full_name VARCHAR(100) NOT NULL,
    email VARCHAR(100) NOT NULL UNIQUE,
    phone VARCHAR(20) NOT NULL,
    id_proof_number VARCHAR(50) NOT NULL UNIQUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;
```
- **`VARCHAR(n)`:** Variable-length character string allocating byte-length + prefix byte, optimizing memory utilization.
- **`UNIQUE`:** Instantiates a B-Tree unique secondary index preventing duplicate identity documents or communication addresses.

---

### 3.3 Table: `Bookings`
```sql
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
```
- **`FOREIGN KEY ... ON DELETE CASCADE`:** Enforces referential action. Purging a parent tuple automatically purges child tuples, ensuring no orphaned references exist.
- **`DATE`:** Three-byte calendar representation (`YYYY-MM-DD`) supporting temporal interval comparisons.

---

### 3.4 Table: `Payments`
```sql
CREATE TABLE Payments (
    payment_id INT AUTO_INCREMENT PRIMARY KEY,
    booking_id INT NOT NULL,
    amount_paid DECIMAL(10, 2) NOT NULL,
    payment_method ENUM('Cash', 'Card', 'UPI') NOT NULL,
    payment_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (booking_id) REFERENCES Bookings(booking_id) ON DELETE CASCADE,
    CONSTRAINT chk_amount_paid CHECK (amount_paid >= 0)
) ENGINE=InnoDB;
```

---

## 4. Relational Integrity & Domain Constraints

Relational integrity guarantees that database operations do not violate business logic or cause state corruption.

| Constraint Type | SQL Implementation | DBMS Theoretical Principle |
| :--- | :--- | :--- |
| **Entity Integrity** | `PRIMARY KEY (room_id, guest_id, ...)` | Enforces that no primary key attribute contains `NULL` and uniquely identifies every tuple in the relation. |
| **Referential Integrity** | `FOREIGN KEY (guest_id) REFERENCES Guests(guest_id)` | Enforces valid associations between tuples; foreign keys must reference valid existing primary keys in parent relations. |
| **Domain Integrity** | `ENUM(...)`, `DECIMAL(10,2)`, `NOT NULL` | Guarantees attribute values belong to the defined domain and value set. |
| **User-Defined Integrity** | `CONSTRAINT chk_booking_dates CHECK (check_out_date > check_in_date)` | Enforces domain-specific invariants across multiple attributes in the same tuple. |
| **Uniqueness Integrity** | `UNIQUE(email)`, `UNIQUE(id_proof_number)` | Prevents duplicate entity representation via unique index structures. |

---

## 5. Data Query Language (DQL) & Relational Algebra

### 5.1 Multi-Table Relational JOINs
A Join operator combines tuples from two or more relations based on common attributes.

```sql
SELECT 
    b.booking_id, g.full_name, r.room_number, p.amount_paid
FROM Bookings b
INNER JOIN Guests g ON b.guest_id = g.guest_id
INNER JOIN Rooms r ON b.room_id = r.room_id
LEFT JOIN Payments p ON b.booking_id = p.booking_id;
```

#### Relational Algebra Translation:
$$((\text{Bookings} \bowtie_{\text{Bookings.guest\_id} = \text{Guests.guest\_id}} \text{Guests}) \bowtie_{\text{Bookings.room\_id} = \text{Rooms.room\_id}} \text{Rooms}) \mathbin{⟕}_{\text{Bookings.booking\_id} = \text{Payments.booking\_id}} \text{Payments}$$

- **`INNER JOIN` ($\bowtie$):** Retains only tuples that satisfy the join predicate on both sides.
- **`LEFT OUTER JOIN` ($\mathbin{⟕}$):** Preserves all tuples from the left relation (`Bookings`), populating `NULL` for right-side attributes if no corresponding payment record has been registered.

---

### 5.2 Dynamic Interval Conflict Detection
To identify if a room is available across an arbitrary user-requested window $[T_{\text{in}}, T_{\text{out}})$, the database must test for temporal overlaps against existing active reservations.

```sql
SELECT r.* FROM Rooms r
WHERE r.status != 'Maintenance'
  AND r.max_occupancy >= ?
  AND r.room_id NOT IN (
    SELECT room_id FROM Bookings
    WHERE booking_status IN ('Reserved', 'Confirmed', 'Checked_In')
      AND check_in_date < ?
      AND check_out_date > ?
  )
ORDER BY r.price_per_night ASC;
```

#### Temporal Overlap Theorem:
Two intervals $[A_{\text{start}}, A_{\text{end}})$ and $[B_{\text{start}}, B_{\text{end}})$ overlap if and only if:
$$A_{\text{start}} < B_{\text{end}} \quad \land \quad A_{\text{end}} > B_{\text{start}}$$

By nesting this logic inside a `NOT IN` subquery (set difference: $R - \pi_{\text{room\_id}}(\sigma_{\text{conflict}}(\text{Bookings}))$), the query guarantees that rooms with even 1 hour of overlap are excluded.

---

## 6. Database Views & Logical Data Independence

A **View** is a virtual relation computed dynamically from base tables on demand. It does not exist as a physical set of stored records (unless materialized).

```sql
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
```

### Theoretical Benefits in DBMS Architecture:
1. **Logical Data Independence:** External applications write queries against `Booking_Details_View`. If the underlying physical schema changes (e.g., column renames or internal table splits), altering the view preserves client compatibility without rewriting application code.
2. **Computed Attributes:** `DATEDIFF(b.check_out_date, b.check_in_date) AS total_nights` calculates stay duration on-the-fly, preventing redundant storage and synchronization anomalies.
3. **Query Simplification:** Flattens a 4-table relational join into a queryable virtual table accessible with simple `SELECT * FROM Booking_Details_View WHERE guest_name LIKE ?`.

---

## 7. Active Database Rules: Triggers & State Machines

A **Trigger** is a procedural routine stored in the database catalog that executes automatically in response to specified Data Manipulation Language (DML) events (`INSERT`, `UPDATE`, `DELETE`) on a table. This implements the **Event-Condition-Action (ECA)** architecture.

```
       [ Booking Event ]
               │
        ┌──────┴──────┐
        ▼             ▼
   AFTER INSERT   AFTER UPDATE
        │             │
        ├─ Walk-in? ──┼─ Status = 'Checked_In' ───► Rooms.status = 'Occupied'
        │             ├─ Status = 'Checked_Out' ──► Rooms.status = 'Cleaning'
        │             └─ Status = 'Cancelled' ────► Rooms.status = 'Available'
        ▼
   AFTER DELETE
        └─ Active Stay? ──────────────────────────► Rooms.status = 'Available'
```

### Trigger 1: `trg_after_booking_insert`
```sql
DELIMITER $$
CREATE TRIGGER trg_after_booking_insert
AFTER INSERT ON Bookings
FOR EACH ROW
BEGIN
    IF NEW.booking_status = 'Checked_In' 
       OR (NEW.booking_status = 'Confirmed' AND NEW.check_in_date <= CURDATE() AND NEW.check_out_date > CURDATE()) THEN
        UPDATE Rooms
        SET status = 'Occupied'
        WHERE room_id = NEW.room_id;
    END IF;
END$$
DELIMITER ;
```
- **Pseudo-record `NEW`:** Represents the newly inserted row state in memory prior to transaction completion.
- **Condition:** If the stay is marked `Checked_In` (immediate walk-in) or is confirmed for the current day, it synchronizes `Rooms.status = 'Occupied'`.

---

### Trigger 2: `trg_after_booking_update` (Housekeeping Turnover Engine)
```sql
DELIMITER $$
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
DELIMITER ;
```
- **Pseudo-record `OLD` vs `NEW`:** Enables state transition auditing:
  $$\Delta = \text{NEW.booking\_status} - \text{OLD.booking\_status}$$
- **Turnover Workflow:** When a guest checks out (`Checked_Out`), the room does **not** become immediately `Available`; it shifts to `Cleaning` status, enforcing hotel sanitary turnover rules.

---

### Trigger 3: `trg_after_booking_delete`
```sql
DELIMITER $$
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
```
- **Rollback Safety:** If an active booking record is dropped from the database, the trigger frees the room asset back to `Available`.

---

## 8. Transactions & ACID Concurrency Control

In high-concurrency environments (e.g., multiple front-desk staff booking rooms simultaneously), race conditions cause **double-booking anomalies** (Lost Updates / Write Skew). The application solves this using **ACID Transactions** with **Pessimistic Row-Level Locking**.

### The ACID Principles:
1. **Atomicity:** All sub-operations (locking the room, verifying capacity, creating the booking, generating payment) succeed as a unified whole, or the transaction rolls back completely (`ROLLBACK`).
2. **Consistency:** Database transitions only from one valid state to another, preserving all check constraints, foreign keys, and invariants.
3. **Isolation:** Concurrent execution of transactions yields the same state as if they were executed serially.
4. **Durability:** Once committed (`COMMIT`), changes survive system crashes and power failures via InnoDB's write-ahead redo log (`ib_logfile`).

---

### Transaction Flow in `server.js`

```javascript
// Step 1: Acquire connection from the connection pool
const connection = await pool.getConnection();
try {
  // Step 2: Begin explicit ACID transaction boundary
  await connection.beginTransaction();

  // Step 3: PESSIMISTIC LOCK on Room row
  const [[room]] = await connection.query(
    'SELECT * FROM Rooms WHERE room_id = ? FOR UPDATE', 
    [room_id]
  );

  // Step 4: Strict interval overlap check with FOR UPDATE lock
  const [conflicts] = await connection.query(`
    SELECT booking_id FROM Bookings
    WHERE room_id = ?
      AND booking_status IN ('Reserved', 'Confirmed', 'Checked_In')
      AND check_in_date < ?
      AND check_out_date > ?
    FOR UPDATE
  `, [room_id, check_out_date, check_in_date]);

  if (conflicts.length > 0) {
    await connection.rollback();
    return res.status(409).json({ error: 'Double-Booking Conflict' });
  }

  // Step 5: Insert Booking record
  const [bRes] = await connection.query(
    'INSERT INTO Bookings (...) VALUES (...)', [...]
  );

  // Step 6: Insert Payment record
  await connection.query(
    'INSERT INTO Payments (...) VALUES (...)', [...]
  );

  // Step 7: Commit all operations atomically
  await connection.commit();
} catch (err) {
  // Step 8: Automatic Rollback on any runtime or constraint failure
  await connection.rollback();
} finally {
  connection.release();
}
```

### Deep Dive: `SELECT ... FOR UPDATE` (Exclusive Locks)
- **Shared Read Locks (`LOCK IN SHARE MODE`):** Allow concurrent readers but block writers.
- **Exclusive Write Locks (`FOR UPDATE`):** Blocks all other concurrent transactions attempting to read with lock, update, or delete the locked rows until the current transaction issues `COMMIT` or `ROLLBACK`.
- **Phantom Row Prevention:** By placing exclusive locks on the target room and the conflicting booking interval, a second transaction attempting to book the identical room must wait in the MySQL lock manager queue until the first transaction commits, completely preventing double bookings.

---

## 9. Relational Error Codes & Integrity Violation Handling

The application translates native MySQL database engine errors into relational explanations:

```javascript
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
```

### Relational Violation Map:
1. **`ER_DUP_ENTRY` (MySQL Error 1062):**
   - **Trigger:** Violating `UNIQUE(email)`, `UNIQUE(id_proof_number)`, or `UNIQUE(room_number)`.
   - **DBMS Meaning:** Uniqueness constraint check failed during index B-Tree leaf insertion.
2. **`ER_CHECK_CONSTRAINT_VIOLATED` (MySQL Error 3819):**
   - **Trigger:** `price_per_night <= 0`, `max_occupancy <= 0`, or `check_out_date <= check_in_date`.
   - **DBMS Meaning:** Tuple rejected because the predicate returned `FALSE` during domain evaluation.
3. **`ER_ROW_IS_REFERENCED_2` (MySQL Error 1451):**
   - **Trigger:** Attempting to drop a room that is currently referenced by an active stay record.
   - **DBMS Meaning:** Referential integrity protection prevented an operation that would create dangling foreign keys.

---

## 10. Exhaustive Catalogue of All Project Queries

Below is the complete inventory of all SQL queries used across the project's migration scripts, schema definitions, and server routes:

| # | SQL Query | Execution Context | Key DBMS Concepts Demonstrated |
| :---: | :--- | :--- | :--- |
| **1** | `SELECT 1 AS alive` | `server.js` (`/api/health`) | **Connection Health Monitoring:** Lowest-overhead ping against the query execution engine. |
| **2** | `SELECT SUM(total_amount) AS total_revenue FROM Bookings WHERE booking_status IN ('Confirmed', 'Checked_In', 'Checked_Out')` | `server.js` (`/api/stats`) | **Aggregate Functions (`SUM`):** Set reduction over filtered partitions; calculates financial ledger balances. |
| **3** | `SELECT COUNT(*) AS total_rooms FROM Rooms` | `server.js` (`/api/stats`) | **Cardinality Estimation:** Computes the total degree and size of the base relation. |
| **4** | `SELECT COUNT(*) AS occupied_rooms FROM Rooms WHERE status = 'Occupied'` | `server.js` (`/api/stats`) | **Filtered Aggregation (`COUNT`):** Computes active inventory allocations to determine the occupancy percentage. |
| **5** | `SELECT COUNT(*) AS active_stays FROM Bookings WHERE booking_status = 'Checked_In'` | `server.js` (`/api/stats`) | **Relational Filtering:** Evaluates current operational capacity based on status predicates. |
| **6** | `SELECT COUNT(*) AS arrivals_today FROM Bookings WHERE check_in_date = CURDATE() AND booking_status IN ('Confirmed', 'Checked_In')` | `server.js` (`/api/stats`) | **Temporal Functions (`CURDATE()`):** System date resolution against temporal attributes. |
| **7** | `SELECT * FROM Rooms WHERE 1=1 AND room_type = ? AND status = ? ORDER BY room_number ASC` | `server.js` (`/api/rooms`) | **Parameterized Dynamic Filtering:** `1=1` predicate pattern allowing programmatic appending of conditional `AND` filters while protecting against SQL Injection. |
| **8** | `SELECT r.* FROM Rooms r WHERE r.status != 'Maintenance' AND r.max_occupancy >= ? AND r.room_id NOT IN (...) ORDER BY r.price_per_night ASC` | `server.js` (`/api/rooms/available`) | **Set Difference / Correlated Subquery:** Eliminates conflicting time-window intervals using mathematical set difference ($A \setminus B$). |
| **9** | `SELECT * FROM Rooms WHERE room_id = ?` | `server.js` (`/api/rooms/:id`) | **Primary Key Index Lookup:** Point query utilizing the Clustered B-Tree Index with $O(\log N)$ time complexity. |
| **10** | `INSERT INTO Rooms (room_number, room_type, price_per_night, max_occupancy) VALUES (?, ?, ?, ?)` | `server.js` (`/api/rooms`) | **Tuple Insertion & Auto-Increment:** Allocates a new surrogate key from internal table sequence generators. |
| **11** | `UPDATE Rooms SET room_number = ?, room_type = ?, price_per_night = ?, max_occupancy = ?, status = ? WHERE room_id = ?` | `server.js` (`/api/rooms/:id`) | **Tuple Modification:** Performs in-place mutation of attribute values with domain constraint validation. |
| **12** | `UPDATE Rooms SET status = 'Available' WHERE room_id = ? AND status = 'Cleaning'` | `server.js` (`/api/rooms/:id/clean`) | **State Machine Transition:** Advances room from Housekeeping turnover queue to operational availability. |
| **13** | `SELECT COUNT(*) AS active_count FROM Bookings WHERE room_id = ? AND booking_status IN ('Reserved', 'Confirmed', 'Checked_In')` | `server.js` (`/api/rooms/:id` DELETE) | **Business Integrity Guard:** Pre-deletion verification to prevent dropping physical inventory tied to pending stays. |
| **14** | `DELETE FROM Rooms WHERE room_id = ?` | `server.js` (`/api/rooms/:id`) | **Tuple Deletion:** Removes physical record; triggers foreign key cascade rules. |
| **15** | `SELECT * FROM Guests WHERE 1=1 AND (full_name LIKE ? OR email LIKE ? OR phone LIKE ?)` | `server.js` (`/api/guests`) | **Pattern Matching (`LIKE`):** Substring text matching against candidate key and contact fields using wildcards (`%term%`). |
| **16** | `INSERT INTO Guests (full_name, email, phone, id_proof_number) VALUES (?, ?, ?, ?)` | `server.js` (`/api/guests`) | **Unique Index Insertion:** Evaluates uniqueness on multiple candidate keys (`email`, `id_proof_number`). |
| **17** | `UPDATE Guests SET full_name = ?, email = ?, phone = ?, id_proof_number = ? WHERE guest_id = ?` | `server.js` (`/api/guests/:id`) | **Entity Update:** Updates guest profile data while maintaining unique constraint checks. |
| **18** | `DELETE FROM Guests WHERE guest_id = ?` | `server.js` (`/api/guests/:id`) | **Cascading Relational Deletion:** Automatically deletes dependent bookings and payments via `ON DELETE CASCADE`. |
| **19** | `SELECT * FROM Booking_Details_View WHERE guest_id = ? ORDER BY booking_id DESC` | `server.js` (`/api/guests/:id/bookings`) | **View Querying:** Accesses denormalized multi-table join view filtered by a specific foreign key. |
| **20** | `SELECT * FROM Booking_Details_View WHERE 1=1 AND booking_status = ? ... ORDER BY booking_id DESC` | `server.js` (`/api/bookings`) | **Universal Ledger Query:** Universal view execution with dynamic status and multi-column search predicates. |
| **21** | `SELECT * FROM Rooms WHERE room_id = ? FOR UPDATE` | `server.js` (`/api/bookings` POST) | **Pessimistic Concurrency Control:** Acquires Exclusive (X) row lock inside transaction to serialize access. |
| **22** | `SELECT booking_id FROM Bookings WHERE room_id = ? AND booking_status IN (...) AND check_in_date < ? AND check_out_date > ? FOR UPDATE` | `server.js` (`/api/bookings` POST) | **Range Locking & Overlap Detection:** Locks conflicting intervals to guarantee zero double bookings. |
| **23** | `INSERT INTO Bookings (guest_id, room_id, num_guests, check_in_date, check_out_date, total_amount, booking_status) VALUES (?, ?, ?, ?, ?, ?, ?)` | `server.js` (`/api/bookings` POST) | **Transactional Insertion:** Writes reservation record and fires `AFTER INSERT` trigger. |
| **24** | `INSERT INTO Payments (booking_id, amount_paid, payment_method) VALUES (?, ?, ?)` | `server.js` (`/api/bookings` POST) | **Dependent Insertion:** Establishes remittance entry tied to newly issued `booking_id` within the atomic transaction. |
| **25** | `UPDATE Bookings SET booking_status = ? WHERE booking_id = ?` | `server.js` (`/api/bookings/:id/status`) | **Trigger Activation (`AFTER UPDATE`):** Modifying booking status activates triggers to adjust room occupancy states. |
| **26** | `DELETE FROM Bookings WHERE booking_id = ?` | `server.js` (`/api/bookings/:id`) | **Protected Deletion:** Rejection logic protects active `Checked_In` stays; valid deletions fire `AFTER DELETE` trigger. |
| **27** | `SELECT payment_id, booking_id, amount_paid, payment_method, payment_date FROM Payments ORDER BY payment_id DESC` | `server.js` (`/api/payments`) | **Direct Ledger Read:** Reads financial remittals for auditing. |
| **28** | `ALTER TABLE Rooms MODIFY COLUMN status ENUM(...) NOT NULL DEFAULT 'Available'` | `migrate.sql` | **DDL Domain Modification:** Updates enum schema to support the housekeeping turnover pipeline. |
| **29** | `PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;` | `migrate.sql` | **Dynamic SQL Execution:** Inspects `information_schema.COLUMNS` to perform idempotent schema migrations. |

---

## 11. Summary: Why This Architecture Ensures Industrial Robustness

1. **Normalized 3NF / BCNF Structure:** Guarantees zero update, insertion, or deletion anomalies across rooms, guests, reservations, and finances.
2. **ACID Transaction Boundaries with `FOR UPDATE`:** Provides strict serializability and row-level locking, preventing double bookings even under heavy concurrency.
3. **Automated Trigger State Machine:** The database itself guarantees that operational states (`Occupied`, `Cleaning`, `Available`) stay synchronized, regardless of which client or application performs the update.
4. **Declarative Integrity Constraints:** Table and column-level `CHECK`, `UNIQUE`, `NOT NULL`, and `FOREIGN KEY ... CASCADE` constraints stop invalid data before it touches storage.
5. **Decoupled View Architecture:** `Booking_Details_View` provides full logical data independence, isolating reporting and user interfaces from physical table restructuring.
