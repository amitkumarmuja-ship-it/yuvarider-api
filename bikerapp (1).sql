-- ============================================================
-- BikerApp PostgreSQL — Schema + Seed Data
-- Updated to match yuvariderapi controllers exactly
-- Run:  psql -U postgres -d bikerapp -f bikerapp.sql
-- ============================================================

-- Step 1 (run separately if needed):
-- CREATE DATABASE bikerapp;

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ── DROP (for clean re-run) ───────────────────────────────────────────────────
DROP TABLE IF EXISTS favourite_locations   CASCADE;
DROP TABLE IF EXISTS sos_alerts            CASCADE;
DROP TABLE IF EXISTS marketplace_listings  CASCADE;
DROP TABLE IF EXISTS accessories           CASCADE;
DROP TABLE IF EXISTS expenses              CASCADE;
DROP TABLE IF EXISTS group_messages        CASCADE;
DROP TABLE IF EXISTS group_rules           CASCADE;
DROP TABLE IF EXISTS group_members         CASCADE;
DROP TABLE IF EXISTS groups                CASCADE;
DROP TABLE IF EXISTS ride_requests         CASCADE;
DROP TABLE IF EXISTS ride_expenses         CASCADE;
DROP TABLE IF EXISTS ride_weather          CASCADE;
DROP TABLE IF EXISTS ride_participants     CASCADE;
DROP TABLE IF EXISTS ride_waypoints        CASCADE;
DROP TABLE IF EXISTS rides                 CASCADE;
DROP TABLE IF EXISTS vehicles              CASCADE;
DROP TABLE IF EXISTS users                 CASCADE;

-- ── TABLES ────────────────────────────────────────────────────────────────────

-- authController uses: id, name, email, password_hash, phone, avatar_url,
--   bio, location, total_rides, total_km, is_active, created_at, updated_at
CREATE TABLE users (
  id            UUID         PRIMARY KEY DEFAULT uuid_generate_v4(),
  name          VARCHAR(100) NOT NULL,
  email         VARCHAR(150) UNIQUE NOT NULL,
  password_hash TEXT         NOT NULL,
  phone         VARCHAR(20),
  avatar_url    TEXT,
  bio           TEXT,
  location      VARCHAR(100),
  total_rides   INT          DEFAULT 0,
  total_km      NUMERIC(10,2) DEFAULT 0,
  is_active     BOOLEAN      DEFAULT TRUE,
  created_at    TIMESTAMPTZ  DEFAULT NOW(),
  updated_at    TIMESTAMPTZ  DEFAULT NOW()
);

-- vehiclesController uses: id, user_id, name, nickname, brand, model, year,
--   engine_cc, color, reg_number, fuel_type, odometer_km, image_url,
--   is_primary, created_at, updated_at
CREATE TABLE vehicles (
  id          UUID         PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id     UUID         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name        VARCHAR(150) NOT NULL,
  nickname    VARCHAR(100),
  brand       VARCHAR(100),
  model       VARCHAR(100),
  year        INT,
  engine_cc   INT,
  color       VARCHAR(50),
  reg_number  VARCHAR(50),
  fuel_type   VARCHAR(30)  DEFAULT 'Petrol',
  odometer_km NUMERIC(10,2) DEFAULT 0,
  image_url   TEXT,
  is_primary  BOOLEAN      DEFAULT FALSE,
  created_at  TIMESTAMPTZ  DEFAULT NOW(),
  updated_at  TIMESTAMPTZ  DEFAULT NOW()
);

-- ridesController uses: id, created_by, name, description, source, destination,
--   start_date, start_time, end_date, end_time, distance_km, duration_hrs,
--   cover_photo, cover_photo_name, status, ride_type, is_paid, entry_fee,
--   max_participants, cloned_count, parent_ride_id, lead_rider_id, marshal_id,
--   sweep_id, tags, scenic, group_id, created_at, updated_at
CREATE TABLE rides (
  id               UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  created_by       UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name             VARCHAR(200) NOT NULL,
  description      TEXT,
  source           VARCHAR(200) NOT NULL,
  destination      VARCHAR(200) NOT NULL,
  start_date       DATE         NOT NULL,
  start_time       TIME         NOT NULL,
  end_date         DATE,
  end_time         TIME,
  distance_km      NUMERIC(10,2),
  duration_hrs     NUMERIC(6,2),
  cover_photo      TEXT,
  cover_photo_name VARCHAR(100),
  status           VARCHAR(30)  DEFAULT 'upcoming'
                   CHECK (status IN ('upcoming','active','completed','cancelled')),
  ride_type        VARCHAR(20)  DEFAULT 'Public'
                   CHECK (ride_type IN ('Public','Private')),
  is_paid          BOOLEAN      DEFAULT FALSE,
  entry_fee        NUMERIC(10,2) DEFAULT 0,
  max_participants INT          DEFAULT 20,
  cloned_count     INT          DEFAULT 0,
  parent_ride_id   UUID         REFERENCES rides(id),
  lead_rider_id    UUID         REFERENCES users(id),
  marshal_id       UUID         REFERENCES users(id),
  sweep_id         UUID         REFERENCES users(id),
  tags             TEXT[]       DEFAULT '{}',
  scenic           BOOLEAN      DEFAULT FALSE,
  group_id         UUID,
  created_at       TIMESTAMPTZ  DEFAULT NOW(),
  updated_at       TIMESTAMPTZ  DEFAULT NOW()
);

-- ridesController uses: id, ride_id, name, stop_time, type, sort_order,
--   lat, lng, created_at
CREATE TABLE ride_waypoints (
  id         UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  ride_id    UUID        NOT NULL REFERENCES rides(id) ON DELETE CASCADE,
  name       VARCHAR(200) NOT NULL,
  stop_time  VARCHAR(20),
  type       VARCHAR(20)  DEFAULT 'stop'
             CHECK (type IN ('start','stop','end')),
  sort_order INT          DEFAULT 0,
  lat        NUMERIC(10,7),
  lng        NUMERIC(10,7),
  created_at TIMESTAMPTZ  DEFAULT NOW()
);

-- ridesController uses: id, ride_id, user_id, role, status, joined_at
CREATE TABLE ride_participants (
  id        UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  ride_id   UUID        NOT NULL REFERENCES rides(id) ON DELETE CASCADE,
  user_id   UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role      VARCHAR(30)  DEFAULT 'member'
            CHECK (role IN ('host','lead_rider','marshal','sweep','member')),
  status    VARCHAR(20)  DEFAULT 'confirmed'
            CHECK (status IN ('pending','confirmed','declined','removed')),
  joined_at TIMESTAMPTZ  DEFAULT NOW(),
  UNIQUE (ride_id, user_id)
);

-- ridesController uses SELECT * — all columns needed:
--   id, ride_id, point, temperature, condition, wind_kmh, fetched_at
CREATE TABLE ride_weather (
  id          UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  ride_id     UUID        NOT NULL REFERENCES rides(id) ON DELETE CASCADE,
  point       VARCHAR(10)  CHECK (point IN ('start','end')),
  temperature NUMERIC(5,2),
  condition   VARCHAR(100),
  wind_kmh    NUMERIC(6,2),
  fetched_at  TIMESTAMPTZ  DEFAULT NOW()
);

-- ridesController uses: id, ride_id, paid_by_id, name, amount, category,
--   payment_method, location, notes, created_at
CREATE TABLE ride_expenses (
  id             UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  ride_id        UUID        NOT NULL REFERENCES rides(id) ON DELETE CASCADE,
  paid_by_id     UUID        NOT NULL REFERENCES users(id),
  name           VARCHAR(200) NOT NULL,
  amount         NUMERIC(10,2) NOT NULL,
  category       VARCHAR(30)  DEFAULT 'Other'
                 CHECK (category IN ('Fuel','Food','Toll','Parking','Maintenance','Other')),
  payment_method VARCHAR(20)  DEFAULT 'cash'
                 CHECK (payment_method IN ('cash','upi','card','wallet')),
  location       VARCHAR(200),
  notes          TEXT,
  created_at     TIMESTAMPTZ  DEFAULT NOW()
);

-- ridesController uses: id, ride_id, user_id, message, status, responded_at,
--   created_at
CREATE TABLE ride_requests (
  id           UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  ride_id      UUID        NOT NULL REFERENCES rides(id) ON DELETE CASCADE,
  user_id      UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  message      TEXT,
  status       VARCHAR(20)  DEFAULT 'pending'
               CHECK (status IN ('pending','approved','rejected')),
  responded_at TIMESTAMPTZ,
  created_at   TIMESTAMPTZ  DEFAULT NOW(),
  UNIQUE (ride_id, user_id)
);

-- groupsController uses: id, name, description, location, cover_image,
--   is_public, member_count, ride_count, total_km, created_by,
--   created_at, updated_at
CREATE TABLE groups (
  id           UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  name         VARCHAR(200) NOT NULL,
  description  TEXT,
  location     VARCHAR(200),
  cover_image  TEXT,
  is_public    BOOLEAN      DEFAULT TRUE,
  member_count INT          DEFAULT 1,
  ride_count   INT          DEFAULT 0,
  total_km     NUMERIC(12,2) DEFAULT 0,
  created_by   UUID         NOT NULL REFERENCES users(id),
  created_at   TIMESTAMPTZ  DEFAULT NOW(),
  updated_at   TIMESTAMPTZ  DEFAULT NOW()
);

-- groupsController uses: id, group_id, user_id, role, joined_at
CREATE TABLE group_members (
  id        UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  group_id  UUID        NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  user_id   UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role      VARCHAR(20)  DEFAULT 'member'
            CHECK (role IN ('admin','member')),
  joined_at TIMESTAMPTZ  DEFAULT NOW(),
  UNIQUE (group_id, user_id)
);

-- groupsController uses: id, group_id, emoji, title, description,
--   is_default, sort_order, created_at
CREATE TABLE group_rules (
  id          UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  group_id    UUID        NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  emoji       VARCHAR(10)  DEFAULT '📌',
  title       VARCHAR(200) NOT NULL,
  description TEXT,
  is_default  BOOLEAN      DEFAULT FALSE,
  sort_order  INT          DEFAULT 0,
  created_at  TIMESTAMPTZ  DEFAULT NOW()
);

-- groupsController uses: id, group_id, sender_id, type, text,
--   image_url, is_pinned, sent_at
CREATE TABLE group_messages (
  id        UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  group_id  UUID        NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  sender_id UUID        REFERENCES users(id),
  type      VARCHAR(20)  DEFAULT 'text'
            CHECK (type IN ('text','system','pinned','image')),
  text      TEXT,
  image_url TEXT,
  is_pinned BOOLEAN      DEFAULT FALSE,
  sent_at   TIMESTAMPTZ  DEFAULT NOW()
);

-- expensesController uses: id, user_id, vehicle_id, ride_id, category,
--   amount, date, description, notes, type, payment_method, location,
--   receipt_count, created_at, updated_at
CREATE TABLE expenses (
  id             UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id        UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  vehicle_id     UUID        REFERENCES vehicles(id),
  ride_id        UUID        REFERENCES rides(id),
  category       VARCHAR(30)  NOT NULL
                 CHECK (category IN ('Fuel','Food','Maintenance','Toll','Parking','Other')),
  amount         NUMERIC(10,2) NOT NULL,
  date           DATE         NOT NULL,
  description    VARCHAR(300),
  notes          TEXT,
  type           VARCHAR(20)  DEFAULT 'personal'
                 CHECK (type IN ('personal','ride')),
  payment_method VARCHAR(20)  DEFAULT 'cash'
                 CHECK (payment_method IN ('cash','upi','card','wallet')),
  location       VARCHAR(200),
  receipt_count  INT          DEFAULT 0,
  created_at     TIMESTAMPTZ  DEFAULT NOW(),
  updated_at     TIMESTAMPTZ  DEFAULT NOW()
);

-- accessoriesController uses: id, user_id, vehicle_id, name, brand, type,
--   price, purchase_date, size, color, store, emoji, bike_name,
--   image_url, notes, created_at, updated_at
CREATE TABLE accessories (
  id            UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id       UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  vehicle_id    UUID        REFERENCES vehicles(id),
  name          VARCHAR(200) NOT NULL,
  brand         VARCHAR(100),
  type          VARCHAR(50),
  price         NUMERIC(10,2),
  purchase_date DATE,
  size          VARCHAR(20),
  color         VARCHAR(50),
  store         VARCHAR(200),
  emoji         VARCHAR(10)  DEFAULT '🔧',
  bike_name     VARCHAR(200),
  image_url     TEXT,
  notes         TEXT,
  created_at    TIMESTAMPTZ  DEFAULT NOW(),
  updated_at    TIMESTAMPTZ  DEFAULT NOW()
);

-- marketplaceController uses: id, seller_id, title, description, price,
--   condition, category, location, contact_pref, status, brand, model,
--   year, km_driven, fuel_type, transmission, owners, gear_type, gear_size,
--   gender, certification, part_type, compatible_bikes, image_urls,
--   view_count, created_at, updated_at
CREATE TABLE marketplace_listings (
  id               UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  seller_id        UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title            VARCHAR(300) NOT NULL,
  description      TEXT,
  price            NUMERIC(12,2) NOT NULL,
  condition        VARCHAR(30),
  category         VARCHAR(50),
  location         VARCHAR(200),
  contact_pref     VARCHAR(30)  DEFAULT 'Chat Only',
  status           VARCHAR(20)  DEFAULT 'active'
                   CHECK (status IN ('active','sold','inactive')),
  brand            VARCHAR(100),
  model            VARCHAR(100),
  year             INT,
  km_driven        NUMERIC(10,2),
  fuel_type        VARCHAR(30),
  transmission     VARCHAR(30),
  owners           VARCHAR(10),
  gear_type        VARCHAR(50),
  gear_size        VARCHAR(20),
  gender           VARCHAR(20),
  certification    VARCHAR(50),
  part_type        VARCHAR(100),
  compatible_bikes VARCHAR(300),
  image_urls       TEXT[]       DEFAULT '{}',
  view_count       INT          DEFAULT 0,
  created_at       TIMESTAMPTZ  DEFAULT NOW(),
  updated_at       TIMESTAMPTZ  DEFAULT NOW()
);

-- sosController uses: id, user_id, ride_id, lat, lng, message, status,
--   created_at, resolved_at
CREATE TABLE sos_alerts (
  id          UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id     UUID        NOT NULL REFERENCES users(id),
  ride_id     UUID        REFERENCES rides(id),
  lat         NUMERIC(10,7),
  lng         NUMERIC(10,7),
  message     TEXT,
  status      VARCHAR(20)  DEFAULT 'active'
              CHECK (status IN ('active','resolved','cancelled')),
  created_at  TIMESTAMPTZ  DEFAULT NOW(),
  resolved_at TIMESTAMPTZ
);

-- ridesController uses: id, user_id, ride_id, name, lat, lng, saved_at
CREATE TABLE favourite_locations (
  id       UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id  UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  ride_id  UUID        REFERENCES rides(id),
  name     VARCHAR(200) NOT NULL,
  lat      NUMERIC(10,7),
  lng      NUMERIC(10,7),
  saved_at TIMESTAMPTZ  DEFAULT NOW()
);

-- ── INDEXES ───────────────────────────────────────────────────────────────────
CREATE INDEX idx_rides_status            ON rides(status);
CREATE INDEX idx_rides_created_by        ON rides(created_by);
CREATE INDEX idx_rides_start_date        ON rides(start_date);
CREATE INDEX idx_ride_participants_ride  ON ride_participants(ride_id);
CREATE INDEX idx_ride_participants_user  ON ride_participants(user_id);
CREATE INDEX idx_expenses_user           ON expenses(user_id);
CREATE INDEX idx_expenses_vehicle        ON expenses(vehicle_id);
CREATE INDEX idx_expenses_date           ON expenses(date);
CREATE INDEX idx_group_members_group     ON group_members(group_id);
CREATE INDEX idx_group_members_user      ON group_members(user_id);
CREATE INDEX idx_group_messages_group    ON group_messages(group_id);
CREATE INDEX idx_marketplace_status      ON marketplace_listings(status);
CREATE INDEX idx_marketplace_category    ON marketplace_listings(category);
CREATE INDEX idx_vehicles_user           ON vehicles(user_id);
CREATE INDEX idx_sos_user                ON sos_alerts(user_id);

-- ── SEED DATA ─────────────────────────────────────────────────────────────────
-- All passwords = "password123"
-- Hash: $2a$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi

INSERT INTO users (id, name, email, password_hash, phone, location, bio, total_rides, total_km) VALUES
  ('a0000001-0000-0000-0000-000000000001','Rahul Kumar',  'rahul@example.com',   '$2a$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi','9876543210','Mumbai',    'Passionate biker. Ride or die.',    45,12500),
  ('a0000001-0000-0000-0000-000000000002','John Smith',   'john@example.com',    '$2a$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi','9876543211','Delhi',     'Long-distance touring enthusiast.', 30, 9800),
  ('a0000001-0000-0000-0000-000000000003','Priya Sharma', 'priya@example.com',   '$2a$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi','9876543212','Pune',      'Adventure & mountain rides.',       28, 7200),
  ('a0000001-0000-0000-0000-000000000004','Amit Singh',   'amit@example.com',    '$2a$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi','9876543213','Bangalore', 'City rides and weekend trips.',     15, 4100),
  ('a0000001-0000-0000-0000-000000000005','Sanjay Kumar', 'sanjay@example.com',  '$2a$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi','9876543214','Mumbai',    'Royal Enfield fan.',                32, 8900),
  ('a0000001-0000-0000-0000-000000000006','Priya Nair',   'priya.n@example.com', '$2a$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi','9876543215','Hyderabad', 'KTM rider and trail explorer.',     20, 5600),
  ('a0000001-0000-0000-0000-000000000007','Rajesh Kumar', 'rajesh@example.com',  '$2a$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi','9876543216','Mumbai',    'Group ride organiser.',             50,18000),
  ('a0000001-0000-0000-0000-000000000008','Arjun Mehta',  'arjun@example.com',   '$2a$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi','9876543217','Delhi',     'Dominar tourer.',                    8, 2100);

INSERT INTO vehicles (id, user_id, name, nickname, brand, model, year, engine_cc, fuel_type, color) VALUES
  ('b0000001-0000-0000-0000-000000000001','a0000001-0000-0000-0000-000000000001','Royal Enfield Classic 350','Beast',    'Royal Enfield','Classic 350',2022,350,'Petrol','Stealth Black'),
  ('b0000001-0000-0000-0000-000000000002','a0000001-0000-0000-0000-000000000001','Bajaj Dominar 400',        'Dominator','Bajaj',        'Dominar 400',2023,400,'Petrol','Aurora Green'),
  ('b0000001-0000-0000-0000-000000000003','a0000001-0000-0000-0000-000000000001','Royal Enfield Himalayan',  'Mountain', 'Royal Enfield','Himalayan',  2021,411,'Petrol','Gravel Grey'),
  ('b0000001-0000-0000-0000-000000000004','a0000001-0000-0000-0000-000000000002','Yamaha R1',                'R1',       'Yamaha',       'YZF-R1',     2023,998,'Petrol','Midnight Black'),
  ('b0000001-0000-0000-0000-000000000005','a0000001-0000-0000-0000-000000000003','KTM Duke 390',             'Duke',     'KTM',          'Duke 390',   2024,390,'Petrol','White'),
  ('b0000001-0000-0000-0000-000000000006','a0000001-0000-0000-0000-000000000004','BMW S1000RR',              'Beemer',   'BMW',          'S1000RR',    2023,999,'Petrol','Racing Red');

-- Rides — all columns match ridesController exactly
INSERT INTO rides (id, created_by, name, description, source, destination,
                   start_date, start_time, end_date, end_time,
                   distance_km, duration_hrs, ride_type, is_paid, entry_fee,
                   max_participants, cloned_count, status, tags, scenic,
                   lead_rider_id, marshal_id, sweep_id) VALUES
  ('c0000001-0000-0000-0000-000000000001',
   'a0000001-0000-0000-0000-000000000001',
   'Lonavala Weekend Ride','A thrilling weekend escape from Mumbai to the scenic ghats of Lonavala.',
   'Mumbai','Lonavala','2026-02-15','06:00','2026-02-15','14:00',
   245,8,'Public',false,0,20,12,'upcoming',ARRAY['Public','Upcoming'],false,
   'a0000001-0000-0000-0000-000000000001','a0000001-0000-0000-0000-000000000002','a0000001-0000-0000-0000-000000000003'),

  ('c0000001-0000-0000-0000-000000000002',
   'a0000001-0000-0000-0000-000000000002',
   'Coastal Highway Run','Breathtaking coastal drive from Bandra to Alibaug along the Konkan coastline.',
   'Bandra','Alibaug','2026-02-18','05:30','2026-02-18','17:30',
   580,12,'Public',true,200,15,8,'upcoming',ARRAY['Public','Paid','Upcoming'],false,
   'a0000001-0000-0000-0000-000000000002','a0000001-0000-0000-0000-000000000004','a0000001-0000-0000-0000-000000000003'),

  ('c0000001-0000-0000-0000-000000000003',
   'a0000001-0000-0000-0000-000000000003',
   'Pune Express','Quick morning dash from Mumbai to Pune on the expressway.',
   'Mumbai','Pune','2026-02-22','05:00','2026-02-22','08:00',
   150,3,'Public',false,0,25,5,'upcoming',ARRAY['Public','Upcoming'],false,
   'a0000001-0000-0000-0000-000000000003',NULL,NULL),

  ('c0000001-0000-0000-0000-000000000004',
   'a0000001-0000-0000-0000-000000000001',
   'Himalayan Adventure','Epic journey from Delhi to Leh through the mighty Himalayas.',
   'Delhi','Leh','2026-01-05','15:00','2026-01-09','09:00',
   9999,90,'Public',true,1500,15,100,'upcoming',ARRAY['Public','Paid','Scenic','Adventure'],true,
   'a0000001-0000-0000-0000-000000000001','a0000001-0000-0000-0000-000000000004','a0000001-0000-0000-0000-000000000002'),

  ('c0000001-0000-0000-0000-000000000005',
   'a0000001-0000-0000-0000-000000000002',
   'Goa Beach Cruise','Three-day coastal ride culminating in the beaches of Goa.',
   'Pune','Goa','2025-12-20','06:00','2025-12-22','18:00',
   595,36,'Public',true,500,20,22,'completed',ARRAY['Public','Paid'],false,
   'a0000001-0000-0000-0000-000000000002','a0000001-0000-0000-0000-000000000003','a0000001-0000-0000-0000-000000000004'),

  ('c0000001-0000-0000-0000-000000000006',
   'a0000001-0000-0000-0000-000000000003',
   'Sunrise Sinhagad Climb','Pre-dawn ride to Sinhagad fort to catch the sunrise.',
   'Pune','Sinhagad Fort','2025-11-10','04:00','2025-11-10','10:00',
   50,6,'Public',false,0,30,7,'completed',ARRAY['Public','Scenic'],true,
   'a0000001-0000-0000-0000-000000000003',NULL,NULL),

  ('c0000001-0000-0000-0000-000000000007',
   'a0000001-0000-0000-0000-000000000001',
   'Manali Winter Ride','Experience the snowclad Manali roads before the passes close.',
   'Delhi','Manali','2026-03-25','07:00','2026-03-27','15:00',
   1050,50,'Private',true,800,10,3,'upcoming',ARRAY['Highway','Adventure'],false,
   'a0000001-0000-0000-0000-000000000001','a0000001-0000-0000-0000-000000000002',NULL),

  ('c0000001-0000-0000-0000-000000000008',
   'a0000001-0000-0000-0000-000000000004',
   'Bangalore Night Blaze','City loop night ride exploring Bangalore landmarks.',
   'Bangalore','Bangalore City Loop','2026-02-28','22:00','2026-03-01','06:00',
   120,8,'Public',false,0,40,15,'upcoming',ARRAY['Public','Highway'],false,
   'a0000001-0000-0000-0000-000000000004',NULL,NULL);

-- ride_waypoints — uses stop_time (not time/arrival_time), sort_order, lat, lng
INSERT INTO ride_waypoints (ride_id, name, stop_time, type, sort_order) VALUES
  ('c0000001-0000-0000-0000-000000000001','Mumbai',                    '6:00 AM', 'start',1),
  ('c0000001-0000-0000-0000-000000000001','Breakfast Stop: Lonavala',  '8:30 AM', 'stop', 2),
  ('c0000001-0000-0000-0000-000000000001','Photo Stop: Khandala Ghats','10:00 AM','stop', 3),
  ('c0000001-0000-0000-0000-000000000001','Lonavala',                  '12:00 PM','end',  4),
  ('c0000001-0000-0000-0000-000000000002','Bandra',                    '5:30 AM', 'start',1),
  ('c0000001-0000-0000-0000-000000000002','Alibaug Ferry',             '9:00 AM', 'stop', 2),
  ('c0000001-0000-0000-0000-000000000002','Alibaug',                   '5:30 PM', 'end',  3),
  ('c0000001-0000-0000-0000-000000000003','Mumbai',                    '5:00 AM', 'start',1),
  ('c0000001-0000-0000-0000-000000000003','Pune',                      '8:00 AM', 'end',  2),
  ('c0000001-0000-0000-0000-000000000004','Delhi',                     '3:00 PM', 'start',1),
  ('c0000001-0000-0000-0000-000000000004','Chandigarh Fuel Stop',      '7:00 PM', 'stop', 2),
  ('c0000001-0000-0000-0000-000000000004','Manali Rest',               '6:00 AM', 'stop', 3),
  ('c0000001-0000-0000-0000-000000000004','Rohtang Pass',              '11:00 AM','stop', 4),
  ('c0000001-0000-0000-0000-000000000004','Leh',                       '9:00 AM', 'end',  5);

INSERT INTO ride_participants (ride_id, user_id, role, status) VALUES
  ('c0000001-0000-0000-0000-000000000001','a0000001-0000-0000-0000-000000000001','host',      'confirmed'),
  ('c0000001-0000-0000-0000-000000000001','a0000001-0000-0000-0000-000000000002','member',    'confirmed'),
  ('c0000001-0000-0000-0000-000000000001','a0000001-0000-0000-0000-000000000003','member',    'confirmed'),
  ('c0000001-0000-0000-0000-000000000001','a0000001-0000-0000-0000-000000000004','member',    'confirmed'),
  ('c0000001-0000-0000-0000-000000000002','a0000001-0000-0000-0000-000000000002','host',      'confirmed'),
  ('c0000001-0000-0000-0000-000000000002','a0000001-0000-0000-0000-000000000001','member',    'confirmed'),
  ('c0000001-0000-0000-0000-000000000002','a0000001-0000-0000-0000-000000000003','member',    'confirmed'),
  ('c0000001-0000-0000-0000-000000000003','a0000001-0000-0000-0000-000000000003','host',      'confirmed'),
  ('c0000001-0000-0000-0000-000000000003','a0000001-0000-0000-0000-000000000004','member',    'confirmed'),
  ('c0000001-0000-0000-0000-000000000004','a0000001-0000-0000-0000-000000000001','host',      'confirmed'),
  ('c0000001-0000-0000-0000-000000000004','a0000001-0000-0000-0000-000000000004','lead_rider','confirmed'),
  ('c0000001-0000-0000-0000-000000000004','a0000001-0000-0000-0000-000000000006','member',    'confirmed');

-- ride_weather — uses temperature, wind_kmh, fetched_at (all match API SELECT *)
INSERT INTO ride_weather (ride_id, point, temperature, condition, wind_kmh) VALUES
  ('c0000001-0000-0000-0000-000000000001','start',28,'Sunny',        12),
  ('c0000001-0000-0000-0000-000000000001','end',  25,'Partly Cloudy', 8),
  ('c0000001-0000-0000-0000-000000000002','start',30,'Sunny',        15),
  ('c0000001-0000-0000-0000-000000000002','end',  27,'Clear',        10),
  ('c0000001-0000-0000-0000-000000000003','start',26,'Clear',        10),
  ('c0000001-0000-0000-0000-000000000003','end',  24,'Sunny',         6);

INSERT INTO groups (id, name, description, location, is_public, ride_count, total_km, created_by) VALUES
  ('d0000001-0000-0000-0000-000000000001','Mumbai Riders',         'City rides and weekend adventures',          'Mumbai',          true, 9, 78000, 'a0000001-0000-0000-0000-000000000001'),
  ('d0000001-0000-0000-0000-000000000002','Weekend Warriors',      'Weekend sunrise & night rides',              'Pune',            true, 7, 45000, 'a0000001-0000-0000-0000-000000000002'),
  ('d0000001-0000-0000-0000-000000000003','Goa Beach Riders',      'Coastal rides and beach adventures',         'Goa',             true,17,120000, 'a0000001-0000-0000-0000-000000000003'),
  ('d0000001-0000-0000-0000-000000000004','Himalayan Explorers',   'Mountain treks and high altitude adventures','Himachal Pradesh', true,31,250000, 'a0000001-0000-0000-0000-000000000001'),
  ('d0000001-0000-0000-0000-000000000005','Bangalore Night Riders','Night rides and city exploration',           'Bangalore',       false,14,65000,  'a0000001-0000-0000-0000-000000000004'),
  ('d0000001-0000-0000-0000-000000000006','Pune Speed Demons',     'Track days and speed enthusiasts',           'Pune',            true, 8, 40000, 'a0000001-0000-0000-0000-000000000002'),
  ('d0000001-0000-0000-0000-000000000007','Delhi NCR Cruisers',    'Highway cruising and long-distance riders',  'Delhi NCR',       true,45,380000, 'a0000001-0000-0000-0000-000000000003'),
  ('d0000001-0000-0000-0000-000000000008','Royal Enfield Owners',  'For Royal Enfield enthusiasts',              'Multiple',        true,22,190000, 'a0000001-0000-0000-0000-000000000004');

INSERT INTO group_members (group_id, user_id, role) VALUES
  ('d0000001-0000-0000-0000-000000000001','a0000001-0000-0000-0000-000000000001','admin'),
  ('d0000001-0000-0000-0000-000000000001','a0000001-0000-0000-0000-000000000002','admin'),
  ('d0000001-0000-0000-0000-000000000001','a0000001-0000-0000-0000-000000000003','member'),
  ('d0000001-0000-0000-0000-000000000001','a0000001-0000-0000-0000-000000000004','member'),
  ('d0000001-0000-0000-0000-000000000002','a0000001-0000-0000-0000-000000000002','admin'),
  ('d0000001-0000-0000-0000-000000000002','a0000001-0000-0000-0000-000000000003','member'),
  ('d0000001-0000-0000-0000-000000000003','a0000001-0000-0000-0000-000000000003','admin'),
  ('d0000001-0000-0000-0000-000000000003','a0000001-0000-0000-0000-000000000004','member'),
  ('d0000001-0000-0000-0000-000000000004','a0000001-0000-0000-0000-000000000001','admin'),
  ('d0000001-0000-0000-0000-000000000004','a0000001-0000-0000-0000-000000000002','member'),
  ('d0000001-0000-0000-0000-000000000005','a0000001-0000-0000-0000-000000000004','admin'),
  ('d0000001-0000-0000-0000-000000000006','a0000001-0000-0000-0000-000000000002','admin'),
  ('d0000001-0000-0000-0000-000000000007','a0000001-0000-0000-0000-000000000003','admin'),
  ('d0000001-0000-0000-0000-000000000008','a0000001-0000-0000-0000-000000000004','admin');

-- group_messages — uses text (not message), sent_at (not created_at), is_pinned
INSERT INTO group_messages (group_id, sender_id, type, text, is_pinned) VALUES
  ('d0000001-0000-0000-0000-000000000001','a0000001-0000-0000-0000-000000000001','text',  'Morning ride tomorrow at 6 AM! Who''s joining?',          false),
  ('d0000001-0000-0000-0000-000000000001','a0000001-0000-0000-0000-000000000002','text',  'I''m in! What''s the route?',                              false),
  ('d0000001-0000-0000-0000-000000000001','a0000001-0000-0000-0000-000000000003','text',  'Let''s take the coastal highway. Beautiful this time!',    false),
  ('d0000001-0000-0000-0000-000000000001','a0000001-0000-0000-0000-000000000002','text',  'Meeting: Shell petrol pump, Bandra. Don''t forget helmets!',false),
  ('d0000001-0000-0000-0000-000000000001','a0000001-0000-0000-0000-000000000001','pinned','Next ride: Sunday 6AM, Bandra Shell Pump',                 true);

INSERT INTO expenses (user_id, vehicle_id, ride_id, category, amount, date, description, type, payment_method, location) VALUES
  ('a0000001-0000-0000-0000-000000000001','b0000001-0000-0000-0000-000000000001','c0000001-0000-0000-0000-000000000001','Fuel',        1200,'2024-11-20','Gas station stop at Mumbai highway','ride',    'upi', 'Mumbai'),
  ('a0000001-0000-0000-0000-000000000001','b0000001-0000-0000-0000-000000000001','c0000001-0000-0000-0000-000000000001','Food',         450,'2024-11-20','Lunch break at coastal restaurant', 'ride',    'cash','Mumbai'),
  ('a0000001-0000-0000-0000-000000000001','b0000001-0000-0000-0000-000000000001','c0000001-0000-0000-0000-000000000003','Toll',         120,'2026-02-26','Mumbai-Pune Express toll',          'ride',    'cash',NULL),
  ('a0000001-0000-0000-0000-000000000001','b0000001-0000-0000-0000-000000000001','c0000001-0000-0000-0000-000000000003','Fuel',        1200,'2026-02-24','Group ride fuel',                   'ride',    'upi', NULL),
  ('a0000001-0000-0000-0000-000000000001','b0000001-0000-0000-0000-000000000001',NULL,                                 'Maintenance', 3500,'2024-11-18','Chain adjustment and oil change',  'personal','upi', NULL),
  ('a0000001-0000-0000-0000-000000000001','b0000001-0000-0000-0000-000000000001',NULL,                                 'Fuel',         850,'2026-02-26','Shell Petrol Pump',                 'personal','upi', NULL),
  ('a0000001-0000-0000-0000-000000000001','b0000001-0000-0000-0000-000000000001',NULL,                                 'Maintenance', 2500,'2026-02-23','Oil change',                        'personal','card',NULL),
  ('a0000001-0000-0000-0000-000000000001','b0000001-0000-0000-0000-000000000001',NULL,                                 'Fuel',         900,'2026-02-22','HP Petrol',                         'personal','upi', NULL),
  ('a0000001-0000-0000-0000-000000000001','b0000001-0000-0000-0000-000000000001',NULL,                                 'Maintenance', 1800,'2026-02-11','Brake pad replacement',             'personal','card',NULL),
  ('a0000001-0000-0000-0000-000000000001','b0000001-0000-0000-0000-000000000001',NULL,                                 'Toll',         180,'2026-02-06','Highway toll',                      'personal','cash',NULL),
  ('a0000001-0000-0000-0000-000000000001','b0000001-0000-0000-0000-000000000001',NULL,                                 'Other',        500,'2026-02-01','Bike wash',                         'personal','cash',NULL);

-- accessories — uses emoji DEFAULT '🔧', bike_name, purchase_date
INSERT INTO accessories (user_id, vehicle_id, name, brand, type, price, purchase_date, size, color, store, emoji) VALUES
  ('a0000001-0000-0000-0000-000000000001','b0000001-0000-0000-0000-000000000003','K6 S Helmet',              'AGV',          'Helmet',35000,'2024-01-15','L', 'Matte Black','BikeRyders Store, Mumbai','🪖'),
  ('a0000001-0000-0000-0000-000000000001','b0000001-0000-0000-0000-000000000003','T-GP Plus R v3 Air Jacket','Alpinestars',  'Jacket',28000,'2024-02-10','XL','Black/White', 'Amazon India',            '🧥'),
  ('a0000001-0000-0000-0000-000000000001','b0000001-0000-0000-0000-000000000003','Summer Gloves',            'Royal Enfield','Gloves', 2500,'2024-03-05','M', 'Brown',       'Royal Enfield Store',     '🧤'),
  ('a0000001-0000-0000-0000-000000000001','b0000001-0000-0000-0000-000000000003','Touring Boots',            'Alpinestars',  'Boots', 15000,'2024-04-12','42','Black',        'BikeRyders Store',        '🥾');

-- marketplace_listings — status = 'active'/'sold'/'inactive' (VARCHAR), view_count (not views)
INSERT INTO marketplace_listings (seller_id, title, description, price, condition, category, location, contact_pref, status, brand, model, year, km_driven, fuel_type, transmission, owners) VALUES
  ('a0000001-0000-0000-0000-000000000001','Royal Enfield Classic 350','Well maintained Classic 350. Single owner.',125000,'Like New','Bikes','Mumbai','Call Allowed','active','Royal Enfield','Classic 350',2022,12000,'Petrol','Manual','1st'),
  ('a0000001-0000-0000-0000-000000000002','Bajaj Pulsar NS200',       'NS200 with recent service. Minor scratch.',  85000,'Good',    'Bikes','Pune',  'Chat Only', 'active','Bajaj',        'Pulsar NS200',2021,22000,'Petrol','Manual','2nd');

INSERT INTO marketplace_listings (seller_id, title, description, price, condition, category, location, contact_pref, status, gear_type, gear_size, gender, certification) VALUES
  ('a0000001-0000-0000-0000-000000000003','SMK Stellar Helmet',   'Barely used. Full-face with visor.',  4500,'New', 'Gear','Pune',     'Chat Only',   'active','Helmet','L', 'Men','ECE'),
  ('a0000001-0000-0000-0000-000000000004','Leather Riding Jacket','CE level 2 armour. Premium leather.', 8500,'Good','Gear','Mumbai',   'Chat Only',   'active','Jacket','XL','Men', NULL),
  ('a0000001-0000-0000-0000-000000000003','Rynox Air GT Gloves',  'Mesh summer gloves. Used 3 times.',   1800,'New', 'Gear','Bangalore','Call Allowed','active','Gloves','M', 'Men', NULL);

INSERT INTO marketplace_listings (seller_id, title, description, price, condition, category, location, contact_pref, status) VALUES
  ('a0000001-0000-0000-0000-000000000005','Saddle Bags Set',      'Weatherproof, fits most bikes.',  3200,'New', 'Accessories','Delhi',    'Chat Only',   'active'),
  ('a0000001-0000-0000-0000-000000000006','LED Fog Lights (Pair)','Universal fit with harness.',     2400,'New', 'Parts',      'Hyderabad','Chat Only',   'active'),
  ('a0000001-0000-0000-0000-000000000006','Chain Tensioner Kit',  'Fits RE, Dominar and more.',      1200,'Good','Parts',      'Chennai',  'Call Allowed','active');
