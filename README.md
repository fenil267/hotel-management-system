# 🏨 Hotel Management System (DBMS Course Project)

A full-stack Hotel Management System built with **Node.js**, **Express**, and **MySQL**, featuring a normalized relational database (3NF), transactional integrity, check constraints, foreign keys, and a responsive frontend dashboard.

---

## 🌟 Key Features

- **Room Inventory Management**: Track room numbers, types (`Single`, `Double`, `Suite`), pricing, occupancy, and status (`Available`, `Occupied`, `Cleaning`, `Maintenance`).
- **Guest Profiles**: Manage guest details with validation on identity proofs and contact information.
- **Booking & Reservations**: Check-in, check-out, date validation, occupancy constraints, and real-time room availability.
- **Billing & Invoicing**: Calculate stay costs, add-on room services, taxes, discount codes, and payment status.
- **Staff Management**: Role assignments, shifts, and department tracking.
- **Database Integrity & Constraints**:
  - Enforced Check Constraints (`chk_room_price`, `chk_max_occupancy`, `chk_booking_dates`).
  - Foreign key cascades and relational integrity guards against orphaned records.
  - Automated status updates and stay duration calculations.

---

## 🛠️ Technology Stack

- **Backend**: Node.js, Express.js, `mysql2/promise`
- **Frontend**: HTML5, CSS3, JavaScript (Single Page Architecture)
- **Database**: MySQL 8.0+
- **Environment**: `dotenv`, `cors`

---

## 🚀 Getting Started

### 1. Prerequisites
- [Node.js](https://nodejs.org/) (v16 or higher)
- [MySQL Server](https://dev.mysql.com/downloads/mysql/) (v8.0 or higher)

### 2. Clone the Repository
```bash
git clone https://github.com/fenil267/hotel-management-system.git
cd hotel-management-system
```

### 3. Install Dependencies
```bash
npm install
```

### 4. Database Setup
1. Create and seed the MySQL database:
   ```bash
   mysql -u root -p < database.sql
   ```
2. (Optional) Run the migration scripts if updating schema:
   ```bash
   node run_migration.js
   ```

### 5. Environment Configuration
Copy the `.env.example` file to `.env` and fill in your MySQL credentials:
```env
PORT=3000
DB_HOST=localhost
DB_USER=root
DB_PASSWORD=your_password
DB_NAME=hotel_db
DB_PORT=3306
```

### 6. Run the Application
- **Production mode:**
  ```bash
  npm start
  ```
- **Development mode (with auto-reload):**
  ```bash
  npm run dev
  ```

Open [http://localhost:3000](http://localhost:3000) in your browser to view the application.

---

## 🧪 Testing

Run the included automated test suite to verify database constraints, integrity rules, and API endpoints:
```bash
node test_suite.js
```

---

## 📄 License
ISC License
