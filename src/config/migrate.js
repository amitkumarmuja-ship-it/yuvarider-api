const pool = require('./db');
require('dotenv').config();

const schema = `
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS users (
  id            UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
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

CREATE TABLE IF NOT EXISTS vehicles (
  id            UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id       UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name          VARCHAR(150) NOT NULL,
  nickname      VARCHAR(100),
  brand         VARCHAR(100),
  model         VARCHAR(100),
  year          INT,
  engine_cc     INT,
  color         VARCHAR(50),
  reg_number    VARCHAR(50),
  fuel_type     VARCHAR(30) DEFAULT 'Petrol',
  odometer_km   NUMERIC(10,2) DEFAULT 0,
  image_url     TEXT,
  is_primary    BOOLEAN     DEFAULT FALSE,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS rides (
  id                UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  created_by        UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name              VARCHAR(200) NOT NULL,
  description       TEXT,
  source            VARCHAR(200) NOT NULL,
  destination       VARCHAR(200) NOT NULL,
  start_date        DATE         NOT NULL,
  start_time        TIME         NOT NULL,
  end_date          DATE,
  end_time          TIME,
  distance_km       NUMERIC(10,2),
  duration_hrs      NUMERIC(6,2),
  cover_photo       TEXT,
  cover_photo_name  VARCHAR(100),
  status            VARCHAR(30)  DEFAULT 'upcoming'
                    CHECK (status IN ('upcoming','active','completed','cancelled')),
  ride_type         VARCHAR(20)  DEFAULT 'Public'
                    CHECK (ride_type IN ('Public','Private')),
  is_paid           BOOLEAN      DEFAULT FALSE,
  entry_fee         NUMERIC(10,2) DEFAULT 0,
  max_participants  INT          DEFAULT 20,
  cloned_count      INT          DEFAULT 0,
  parent_ride_id    UUID         REFERENCES rides(id),
  lead_rider_id     UUID         REFERENCES users(id),
  marshal_id        UUID         REFERENCES users(id),
  sweep_id          UUID         REFERENCES users(id),
  tags              TEXT[]       DEFAULT '{}',
  scenic            BOOLEAN      DEFAULT FALSE,
  group_id          UUID,
  created_at        TIMESTAMPTZ  DEFAULT NOW(),
  updated_at        TIMESTAMPTZ  DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS ride_waypoints (
  id         UUID       PRIMARY KEY DEFAULT uuid_generate_v4(),
  ride_id    UUID       NOT NULL REFERENCES rides(id) ON DELETE CASCADE,
  name       VARCHAR(200) NOT NULL,
  stop_time  VARCHAR(20),
  type       VARCHAR(20)  DEFAULT 'stop'
             CHECK (type IN ('start','stop','end')),
  sort_order INT        DEFAULT 0,
  lat        NUMERIC(10,7),
  lng        NUMERIC(10,7),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS ride_participants (
  id         UUID       PRIMARY KEY DEFAULT uuid_generate_v4(),
  ride_id    UUID       NOT NULL REFERENCES rides(id) ON DELETE CASCADE,
  user_id    UUID       NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role       VARCHAR(30) DEFAULT 'member'
             CHECK (role IN ('host','lead_rider','marshal','sweep','member')),
  status     VARCHAR(20) DEFAULT 'confirmed'
             CHECK (status IN ('pending','confirmed','declined','removed')),
  joined_at  TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (ride_id, user_id)
);

CREATE TABLE IF NOT EXISTS ride_weather (
  id          UUID       PRIMARY KEY DEFAULT uuid_generate_v4(),
  ride_id     UUID       NOT NULL REFERENCES rides(id) ON DELETE CASCADE,
  point       VARCHAR(10) CHECK (point IN ('start','end')),
  temperature NUMERIC(5,2),
  condition   VARCHAR(100),
  wind_kmh    NUMERIC(6,2),
  fetched_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS ride_expenses (
  id             UUID       PRIMARY KEY DEFAULT uuid_generate_v4(),
  ride_id        UUID       NOT NULL REFERENCES rides(id) ON DELETE CASCADE,
  paid_by_id     UUID       NOT NULL REFERENCES users(id),
  name           VARCHAR(200) NOT NULL,
  amount         NUMERIC(10,2) NOT NULL,
  category       VARCHAR(30) DEFAULT 'Other'
                 CHECK (category IN ('Fuel','Food','Toll','Parking','Maintenance','Other')),
  payment_method VARCHAR(20) DEFAULT 'cash'
                 CHECK (payment_method IN ('cash','upi','card','wallet')),
  location       VARCHAR(200),
  notes          TEXT,
  created_at     TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS ride_requests (
  id          UUID       PRIMARY KEY DEFAULT uuid_generate_v4(),
  ride_id     UUID       NOT NULL REFERENCES rides(id) ON DELETE CASCADE,
  user_id     UUID       NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  message     TEXT,
  status      VARCHAR(20) DEFAULT 'pending'
              CHECK (status IN ('pending','approved','rejected')),
  responded_at TIMESTAMPTZ,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (ride_id, user_id)
);

CREATE TABLE IF NOT EXISTS groups (
  id            UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  name          VARCHAR(200) NOT NULL,
  description   TEXT,
  location      VARCHAR(200),
  cover_image   TEXT,
  is_public     BOOLEAN      DEFAULT TRUE,
  member_count  INT          DEFAULT 1,
  ride_count    INT          DEFAULT 0,
  total_km      NUMERIC(12,2) DEFAULT 0,
  created_by    UUID         NOT NULL REFERENCES users(id),
  created_at    TIMESTAMPTZ  DEFAULT NOW(),
  updated_at    TIMESTAMPTZ  DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS group_members (
  id         UUID       PRIMARY KEY DEFAULT uuid_generate_v4(),
  group_id   UUID       NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  user_id    UUID       NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role       VARCHAR(20) DEFAULT 'member'
             CHECK (role IN ('admin','member')),
  joined_at  TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (group_id, user_id)
);

CREATE TABLE IF NOT EXISTS group_rules (
  id           UUID       PRIMARY KEY DEFAULT uuid_generate_v4(),
  group_id     UUID       NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  emoji        VARCHAR(10) DEFAULT '📌',
  title        VARCHAR(200) NOT NULL,
  description  TEXT,
  is_default   BOOLEAN     DEFAULT FALSE,
  sort_order   INT         DEFAULT 0,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS group_messages (
  id          UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  group_id    UUID        NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  sender_id   UUID        REFERENCES users(id),
  type        VARCHAR(20)  DEFAULT 'text'
              CHECK (type IN ('text','system','pinned','image')),
  text        TEXT,
  image_url   TEXT,
  is_pinned   BOOLEAN      DEFAULT FALSE,
  sent_at     TIMESTAMPTZ  DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS expenses (
  id             UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id        UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  vehicle_id     UUID        REFERENCES vehicles(id),
  ride_id        UUID        REFERENCES rides(id),
  category       VARCHAR(30)  NOT NULL
                 CHECK (category IN ('Fuel','Food','Mechanic','Maintenance','Gear','Toll','Parking','Custom','Other')),
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

CREATE TABLE IF NOT EXISTS accessories (
  id             UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id        UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  vehicle_id     UUID        REFERENCES vehicles(id),
  name           VARCHAR(200) NOT NULL,
  brand          VARCHAR(100),
  type           VARCHAR(50),
  price          NUMERIC(10,2),
  purchase_date  DATE,
  size           VARCHAR(20),
  color          VARCHAR(50),
  store          VARCHAR(200),
  emoji          VARCHAR(10)  DEFAULT '🏍',
  bike_name      VARCHAR(200),
  image_url      TEXT,
  image_urls     TEXT[]       DEFAULT '{}',
  notes          TEXT,
  created_at     TIMESTAMPTZ  DEFAULT NOW(),
  updated_at     TIMESTAMPTZ  DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS marketplace_listings (
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

CREATE TABLE IF NOT EXISTS sos_alerts (
  id          UUID       PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id     UUID       NOT NULL REFERENCES users(id),
  ride_id     UUID       REFERENCES rides(id),
  lat         NUMERIC(10,7),
  lng         NUMERIC(10,7),
  message     TEXT,
  status      VARCHAR(20) DEFAULT 'active'
              CHECK (status IN ('active','resolved','cancelled')),
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  resolved_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS favourite_locations (
  id         UUID       PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id    UUID       NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  ride_id    UUID       REFERENCES rides(id),
  name       VARCHAR(200) NOT NULL,
  lat        NUMERIC(10,7),
  lng        NUMERIC(10,7),
  saved_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_rides_status           ON rides(status);
CREATE INDEX IF NOT EXISTS idx_rides_created_by       ON rides(created_by);
CREATE INDEX IF NOT EXISTS idx_rides_start_date       ON rides(start_date);
CREATE INDEX IF NOT EXISTS idx_ride_participants_ride ON ride_participants(ride_id);
CREATE INDEX IF NOT EXISTS idx_ride_participants_user ON ride_participants(user_id);
CREATE INDEX IF NOT EXISTS idx_expenses_user          ON expenses(user_id);
CREATE INDEX IF NOT EXISTS idx_expenses_vehicle       ON expenses(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_group_members_group    ON group_members(group_id);
CREATE INDEX IF NOT EXISTS idx_group_members_user     ON group_members(user_id);
CREATE INDEX IF NOT EXISTS idx_marketplace_status     ON marketplace_listings(status);
CREATE INDEX IF NOT EXISTS idx_marketplace_category   ON marketplace_listings(category);
CREATE INDEX IF NOT EXISTS idx_vehicles_user          ON vehicles(user_id);
`;

async function migrate() {
  const client = await pool.connect();
  try {
    console.log('Running migrations...');
    await client.query(schema);
    console.log('All tables created successfully!');
  } catch (err) {
    console.error('Migration failed:', err.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

migrate();
