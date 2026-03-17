/**
 * BikerApp — Database Seed
 * Column names match migrate.js exactly.
 * RULE: Never pass a $N param that isn't referenced in the SQL —
 *       PostgreSQL throws "could not determine data type of parameter $N".
 */

const pool   = require('./db');
const bcrypt = require('bcryptjs');

async function seed() {
  const client = await pool.connect();
  try {
    console.log('🌱 Seeding database...\n');
    await client.query('BEGIN');

    // ── USERS ──────────────────────────────────────────────────────────────────
    const hash = await bcrypt.hash('password123', 10);

    await client.query(`
      INSERT INTO users (id, name, email, password_hash, phone, location, bio, total_rides, total_km) VALUES
        ('a0000001-0000-0000-0000-000000000001','Rahul Kumar',  'rahul@example.com',   $1,'9876543210','Mumbai',    'Passionate biker. Ride or die.',    45,12500),
        ('a0000001-0000-0000-0000-000000000002','John Smith',   'john@example.com',    $1,'9876543211','Delhi',     'Long-distance touring enthusiast.', 30, 9800),
        ('a0000001-0000-0000-0000-000000000003','Priya Sharma', 'priya@example.com',   $1,'9876543212','Pune',      'Adventure & mountain rides.',       28, 7200),
        ('a0000001-0000-0000-0000-000000000004','Amit Singh',   'amit@example.com',    $1,'9876543213','Bangalore', 'City rides and weekend trips.',     15, 4100),
        ('a0000001-0000-0000-0000-000000000005','Sanjay Kumar', 'sanjay@example.com',  $1,'9876543214','Mumbai',    'Royal Enfield fan.',                32, 8900),
        ('a0000001-0000-0000-0000-000000000006','Priya Nair',   'priya.n@example.com', $1,'9876543215','Hyderabad', 'KTM rider and trail explorer.',     20, 5600),
        ('a0000001-0000-0000-0000-000000000007','Rajesh Kumar', 'rajesh@example.com',  $1,'9876543216','Mumbai',    'Group ride organiser.',             50,18000),
        ('a0000001-0000-0000-0000-000000000008','Arjun Mehta',  'arjun@example.com',   $1,'9876543217','Delhi',     'Dominar tourer.',                    8, 2100)
      ON CONFLICT (email) DO NOTHING
    `, [hash]);
    console.log('  ✅ Users seeded');

    // User UUIDs
    const RAHUL  = 'a0000001-0000-0000-0000-000000000001';
    const JOHN   = 'a0000001-0000-0000-0000-000000000002';
    const PRIYA  = 'a0000001-0000-0000-0000-000000000003';
    const AMIT   = 'a0000001-0000-0000-0000-000000000004';
    const SANJAY = 'a0000001-0000-0000-0000-000000000005';
    const NAIR   = 'a0000001-0000-0000-0000-000000000006';

    // ── VEHICLES ───────────────────────────────────────────────────────────────
    // $1=user, no gaps
    await client.query(`
      INSERT INTO vehicles (id, user_id, name, nickname, brand, model, year, engine_cc, fuel_type, color) VALUES
        ('b0000001-0000-0000-0000-000000000001',$1,'Royal Enfield Classic 350','Beast',    'Royal Enfield','Classic 350',2022,350,'Petrol','Stealth Black'),
        ('b0000001-0000-0000-0000-000000000002',$1,'Bajaj Dominar 400',        'Dominator','Bajaj',        'Dominar 400',2023,400,'Petrol','Aurora Green'),
        ('b0000001-0000-0000-0000-000000000003',$1,'Royal Enfield Himalayan',  'Mountain', 'Royal Enfield','Himalayan',  2021,411,'Petrol','Gravel Grey')
      ON CONFLICT (id) DO NOTHING
    `, [RAHUL]);

    await client.query(`
      INSERT INTO vehicles (id, user_id, name, nickname, brand, model, year, engine_cc, fuel_type, color) VALUES
        ('b0000001-0000-0000-0000-000000000004',$1,'Yamaha R1',   'R1',    'Yamaha','YZF-R1',  2023,998,'Petrol','Midnight Black'),
        ('b0000001-0000-0000-0000-000000000005',$2,'KTM Duke 390','Duke',  'KTM',  'Duke 390', 2024,390,'Petrol','White'),
        ('b0000001-0000-0000-0000-000000000006',$3,'BMW S1000RR', 'Beemer','BMW',  'S1000RR',  2023,999,'Petrol','Racing Red')
      ON CONFLICT (id) DO NOTHING
    `, [JOHN, PRIYA, AMIT]);
    console.log('  ✅ Vehicles seeded');

    // Vehicle UUIDs
    const CLASSIC350 = 'b0000001-0000-0000-0000-000000000001';
    const HIMALAYAN  = 'b0000001-0000-0000-0000-000000000003';

    // ── RIDES ──────────────────────────────────────────────────────────────────
    // Split into batches so every $N in the SQL maps directly to its param
    // Ride 1 — host=RAHUL, lead=RAHUL, marshal=JOHN, sweep=PRIYA
    await client.query(`
      INSERT INTO rides (id, created_by, name, description, source, destination,
                         start_date, start_time, end_date, end_time,
                         distance_km, duration_hrs, ride_type, is_paid, entry_fee,
                         max_participants, cloned_count, status, tags, scenic,
                         lead_rider_id, marshal_id, sweep_id) VALUES
        ('c0000001-0000-0000-0000-000000000001',$1,
         'Lonavala Weekend Ride','A thrilling weekend escape from Mumbai to the scenic ghats of Lonavala.',
         'Mumbai','Lonavala','2026-02-15','06:00','2026-02-15','14:00',
         245,8,'Public',false,0,20,12,'upcoming',ARRAY['Public','Upcoming'],false, $1,$2,$3)
      ON CONFLICT (id) DO NOTHING
    `, [RAHUL, JOHN, PRIYA]);

    // Ride 2 — host=JOHN
    await client.query(`
      INSERT INTO rides (id, created_by, name, description, source, destination,
                         start_date, start_time, end_date, end_time,
                         distance_km, duration_hrs, ride_type, is_paid, entry_fee,
                         max_participants, cloned_count, status, tags, scenic,
                         lead_rider_id, marshal_id, sweep_id) VALUES
        ('c0000001-0000-0000-0000-000000000002',$1,
         'Coastal Highway Run','Breathtaking coastal drive from Bandra to Alibaug along the Konkan coastline.',
         'Bandra','Alibaug','2026-02-18','05:30','2026-02-18','17:30',
         580,12,'Public',true,200,15,8,'upcoming',ARRAY['Public','Paid','Upcoming'],false, $1,$2,$3)
      ON CONFLICT (id) DO NOTHING
    `, [JOHN, AMIT, PRIYA]);

    // Ride 3 — host=PRIYA, no roles
    await client.query(`
      INSERT INTO rides (id, created_by, name, description, source, destination,
                         start_date, start_time, end_date, end_time,
                         distance_km, duration_hrs, ride_type, is_paid, entry_fee,
                         max_participants, cloned_count, status, tags, scenic) VALUES
        ('c0000001-0000-0000-0000-000000000003',$1,
         'Pune Express','Quick morning dash from Mumbai to Pune on the expressway.',
         'Mumbai','Pune','2026-02-22','05:00','2026-02-22','08:00',
         150,3,'Public',false,0,25,5,'upcoming',ARRAY['Public','Upcoming'],false)
      ON CONFLICT (id) DO NOTHING
    `, [PRIYA]);

    // Ride 4 — Himalayan (host=RAHUL)
    await client.query(`
      INSERT INTO rides (id, created_by, name, description, source, destination,
                         start_date, start_time, end_date, end_time,
                         distance_km, duration_hrs, ride_type, is_paid, entry_fee,
                         max_participants, cloned_count, status, tags, scenic,
                         lead_rider_id, marshal_id, sweep_id) VALUES
        ('c0000001-0000-0000-0000-000000000004',$1,
         'Himalayan Adventure','Epic journey from Delhi to Leh through the mighty Himalayas.',
         'Delhi','Leh','2026-01-05','15:00','2026-01-09','09:00',
         9999,90,'Public',true,1500,15,100,'upcoming',ARRAY['Public','Paid','Scenic','Adventure'],true, $1,$2,$3)
      ON CONFLICT (id) DO NOTHING
    `, [RAHUL, AMIT, JOHN]);

    // Rides 5-8 in one shot — only literal values, no param gaps
    await client.query(`
      INSERT INTO rides (id, created_by, name, description, source, destination,
                         start_date, start_time, end_date, end_time,
                         distance_km, duration_hrs, ride_type, is_paid, entry_fee,
                         max_participants, cloned_count, status, tags, scenic,
                         lead_rider_id, marshal_id, sweep_id) VALUES
        ('c0000001-0000-0000-0000-000000000005',$1,
         'Goa Beach Cruise','Three-day coastal ride culminating in the beaches of Goa.',
         'Pune','Goa','2025-12-20','06:00','2025-12-22','18:00',
         595,36,'Public',true,500,20,22,'completed',ARRAY['Public','Paid'],false, $1,$2,$3),

        ('c0000001-0000-0000-0000-000000000006',$2,
         'Sunrise Sinhagad Climb','Pre-dawn ride to Sinhagad fort to catch the sunrise.',
         'Pune','Sinhagad Fort','2025-11-10','04:00','2025-11-10','10:00',
         50,6,'Public',false,0,30,7,'completed',ARRAY['Public','Scenic'],true, $2,NULL,NULL),

        ('c0000001-0000-0000-0000-000000000007',$4,
         'Manali Winter Ride','Experience the snowclad Manali roads before the passes close.',
         'Delhi','Manali','2026-03-25','07:00','2026-03-27','15:00',
         1050,50,'Private',true,800,10,3,'upcoming',ARRAY['Highway','Adventure'],false, $4,$1,NULL),

        ('c0000001-0000-0000-0000-000000000008',$3,
         'Bangalore Night Blaze','City loop night ride exploring Bangalore landmarks.',
         'Bangalore','Bangalore City Loop','2026-02-28','22:00','2026-03-01','06:00',
         120,8,'Public',false,0,40,15,'upcoming',ARRAY['Public','Highway'],false, $3,NULL,NULL)
      ON CONFLICT (id) DO NOTHING
    `, [JOHN, PRIYA, AMIT, RAHUL]);
    console.log('  ✅ Rides seeded');

    const LONAVALA     = 'c0000001-0000-0000-0000-000000000001';
    const COASTAL      = 'c0000001-0000-0000-0000-000000000002';
    const PUNE_EXPRESS = 'c0000001-0000-0000-0000-000000000003';
    const HIMALAYAN_R  = 'c0000001-0000-0000-0000-000000000004';

    // ── WAYPOINTS — one ride per query, each $N used ────────────────────────────
    await client.query(`
      INSERT INTO ride_waypoints (ride_id, name, stop_time, type, sort_order) VALUES
        ($1,'Mumbai',                   '6:00 AM', 'start',1),
        ($1,'Breakfast Stop: Lonavala', '8:30 AM', 'stop', 2),
        ($1,'Photo Stop: Khandala Ghats','10:00 AM','stop', 3),
        ($1,'Lonavala',                 '12:00 PM','end',  4)
    `, [LONAVALA]);

    await client.query(`
      INSERT INTO ride_waypoints (ride_id, name, stop_time, type, sort_order) VALUES
        ($1,'Bandra',       '5:30 AM','start',1),
        ($1,'Alibaug Ferry','9:00 AM','stop', 2),
        ($1,'Alibaug',      '5:30 PM','end',  3)
    `, [COASTAL]);

    await client.query(`
      INSERT INTO ride_waypoints (ride_id, name, stop_time, type, sort_order) VALUES
        ($1,'Mumbai','5:00 AM','start',1),
        ($1,'Pune',  '8:00 AM','end',  2)
    `, [PUNE_EXPRESS]);

    await client.query(`
      INSERT INTO ride_waypoints (ride_id, name, stop_time, type, sort_order) VALUES
        ($1,'Delhi',               '3:00 PM', 'start',1),
        ($1,'Chandigarh Fuel Stop','7:00 PM', 'stop', 2),
        ($1,'Manali Rest',         '6:00 AM', 'stop', 3),
        ($1,'Rohtang Pass',        '11:00 AM','stop', 4),
        ($1,'Leh',                 '9:00 AM', 'end',  5)
    `, [HIMALAYAN_R]);
    console.log('  ✅ Waypoints seeded');

    // ── PARTICIPANTS ────────────────────────────────────────────────────────────
    await client.query(`
      INSERT INTO ride_participants (ride_id, user_id, role, status) VALUES
        ($1,$2,'host',      'confirmed'),
        ($1,$3,'member',    'confirmed'),
        ($1,$4,'member',    'confirmed'),
        ($1,$5,'member',    'confirmed')
      ON CONFLICT (ride_id, user_id) DO NOTHING
    `, [LONAVALA, RAHUL, JOHN, PRIYA, AMIT]);

    await client.query(`
      INSERT INTO ride_participants (ride_id, user_id, role, status) VALUES
        ($1,$2,'host',  'confirmed'),
        ($1,$3,'member','confirmed'),
        ($1,$4,'member','confirmed')
      ON CONFLICT (ride_id, user_id) DO NOTHING
    `, [COASTAL, JOHN, RAHUL, PRIYA]);

    await client.query(`
      INSERT INTO ride_participants (ride_id, user_id, role, status) VALUES
        ($1,$2,'host',  'confirmed'),
        ($1,$3,'member','confirmed')
      ON CONFLICT (ride_id, user_id) DO NOTHING
    `, [PUNE_EXPRESS, PRIYA, AMIT]);

    await client.query(`
      INSERT INTO ride_participants (ride_id, user_id, role, status) VALUES
        ($1,$2,'host',      'confirmed'),
        ($1,$3,'lead_rider','confirmed'),
        ($1,$4,'member',    'confirmed')
      ON CONFLICT (ride_id, user_id) DO NOTHING
    `, [HIMALAYAN_R, RAHUL, AMIT, NAIR]);
    console.log('  ✅ Participants seeded');

    // ── WEATHER — $1=ride_id only, no unused params ─────────────────────────────
    await client.query(`
      INSERT INTO ride_weather (ride_id, point, temperature, condition, wind_kmh) VALUES
        ($1,'start',28,'Sunny',        12),
        ($1,'end',  25,'Partly Cloudy', 8)
    `, [LONAVALA]);

    await client.query(`
      INSERT INTO ride_weather (ride_id, point, temperature, condition, wind_kmh) VALUES
        ($1,'start',30,'Sunny',15),
        ($1,'end',  27,'Clear',10)
    `, [COASTAL]);

    await client.query(`
      INSERT INTO ride_weather (ride_id, point, temperature, condition, wind_kmh) VALUES
        ($1,'start',26,'Clear',10),
        ($1,'end',  24,'Sunny', 6)
    `, [PUNE_EXPRESS]);
    console.log('  ✅ Ride weather seeded');

    // ── GROUPS ──────────────────────────────────────────────────────────────────
    // Each group has a distinct created_by — use one param per query to avoid gaps
    const groupData = [
      ['d0000001-0000-0000-0000-000000000001','Mumbai Riders',         'City rides and weekend adventures',          'Mumbai',          true, 9, 78000, RAHUL],
      ['d0000001-0000-0000-0000-000000000002','Weekend Warriors',      'Weekend sunrise & night rides',              'Pune',            true, 7, 45000, JOHN],
      ['d0000001-0000-0000-0000-000000000003','Goa Beach Riders',      'Coastal rides and beach adventures',         'Goa',             true,17,120000, PRIYA],
      ['d0000001-0000-0000-0000-000000000004','Himalayan Explorers',   'Mountain treks and high altitude adventures','Himachal Pradesh', true,31,250000, RAHUL],
      ['d0000001-0000-0000-0000-000000000005','Bangalore Night Riders','Night rides and city exploration',           'Bangalore',      false,14, 65000, AMIT],
      ['d0000001-0000-0000-0000-000000000006','Pune Speed Demons',     'Track days and speed enthusiasts',           'Pune',            true, 8, 40000, JOHN],
      ['d0000001-0000-0000-0000-000000000007','Delhi NCR Cruisers',    'Highway cruising and long-distance riders',  'Delhi NCR',       true,45,380000, PRIYA],
      ['d0000001-0000-0000-0000-000000000008','Royal Enfield Owners',  'For Royal Enfield enthusiasts',              'Multiple',        true,22,190000, AMIT],
    ];
    for (const [id, name, desc, loc, pub, rides, km, creator] of groupData) {
      await client.query(
        `INSERT INTO groups (id, name, description, location, is_public, ride_count, total_km, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (id) DO NOTHING`,
        [id, name, desc, loc, pub, rides, km, creator]
      );
    }
    console.log('  ✅ Groups seeded');

    const G_MUMBAI    = 'd0000001-0000-0000-0000-000000000001';
    const G_WEEKEND   = 'd0000001-0000-0000-0000-000000000002';
    const G_GOA       = 'd0000001-0000-0000-0000-000000000003';
    const G_HIMALAYAN = 'd0000001-0000-0000-0000-000000000004';
    const G_BLORE     = 'd0000001-0000-0000-0000-000000000005';
    const G_PUNE      = 'd0000001-0000-0000-0000-000000000006';
    const G_DELHI     = 'd0000001-0000-0000-0000-000000000007';
    const G_ROYAL     = 'd0000001-0000-0000-0000-000000000008';

    // Group members — each row individually so no unused params
    const memberData = [
      [G_MUMBAI, RAHUL, 'admin'], [G_MUMBAI, JOHN, 'admin'], [G_MUMBAI, PRIYA, 'member'], [G_MUMBAI, AMIT, 'member'],
      [G_WEEKEND, JOHN, 'admin'], [G_WEEKEND, PRIYA, 'member'],
      [G_GOA, PRIYA, 'admin'], [G_GOA, AMIT, 'member'],
      [G_HIMALAYAN, RAHUL, 'admin'], [G_HIMALAYAN, JOHN, 'member'], [G_HIMALAYAN, AMIT, 'member'],
      [G_BLORE, AMIT, 'admin'],
      [G_PUNE, JOHN, 'admin'],
      [G_DELHI, PRIYA, 'admin'],
      [G_ROYAL, AMIT, 'admin'],
    ];
    for (const [gid, uid, role] of memberData) {
      await client.query(
        `INSERT INTO group_members (group_id, user_id, role) VALUES ($1,$2,$3) ON CONFLICT (group_id, user_id) DO NOTHING`,
        [gid, uid, role]
      );
    }

    // Group rules
    const rules = [
      ['🚫','No political discussions',        'Political posts are not allowed',              true],
      ['🚫','No religious discussions',        'Religious content is not permitted',            true],
      ['💰','No money sharing or lending',     'Money requests are not allowed',               true],
      ['🤝','Be respectful to all members',    'No abusive language or personal attacks',       true],
      ['📢','No spam or promotions',           'No ads without admin approval',                true],
      ['⛑️','Follow ride safety rules',        'Helmet and basic safety must be followed',     true],
      ['👑',"Admin's decision is final",       'Admin decisions must be respected',            true],
      ['🌙','No messages after 11 PM',         'Avoid late night messages unless emergency',   true],
      ['🏍️','Keep discussions biking-related', 'Stay on topic: riding, bikes, trips',          true],
      ['🔞','No inappropriate content',        'Offensive images or messages are prohibited',  true],
    ];
    for (const gid of [G_MUMBAI, G_WEEKEND, G_GOA, G_HIMALAYAN]) {
      for (let i = 0; i < rules.length; i++) {
        const [emoji, title, desc, isDef] = rules[i];
        await client.query(
          `INSERT INTO group_rules (group_id, emoji, title, description, is_default, sort_order)
           VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING`,
          [gid, emoji, title, desc, isDef, i + 1]
        );
      }
    }

    // Group messages — $1=group, $2=sender — each sender its own query
    const msgData = [
      [G_MUMBAI, RAHUL, 'text',   "Morning ride tomorrow at 6 AM! Who's joining?"],
      [G_MUMBAI, JOHN,  'text',   "I'm in! What's the route?"],
      [G_MUMBAI, PRIYA, 'text',   "Let's take the coastal highway. Beautiful this time of year."],
      [G_MUMBAI, JOHN,  'text',   "Great! Meeting: Shell petrol pump, Bandra. Don't forget helmets!"],
      [G_MUMBAI, RAHUL, 'pinned', 'Next ride: Sunday 6AM, Bandra Shell Pump'],
    ];
    for (const [gid, sid, type, text] of msgData) {
      await client.query(
        `INSERT INTO group_messages (group_id, sender_id, type, text) VALUES ($1,$2,$3,$4)`,
        [gid, sid, type, text]
      );
    }
    console.log('  ✅ Groups + members + rules + messages seeded');

    // ── EXPENSES — $1=user, $2=vehicle, $3=ride (where applicable) ─────────────
    // Ride expenses (with ride_id)
    await client.query(`
      INSERT INTO expenses (user_id, vehicle_id, ride_id, category, amount, date, description, type, payment_method, location) VALUES
        ($1,$2,$3,'Fuel',1200,'2024-11-20','Gas station stop at Mumbai highway','ride','upi','Mumbai'),
        ($1,$2,$3,'Food', 450,'2024-11-20','Lunch break at coastal restaurant', 'ride','cash','Mumbai')
    `, [RAHUL, CLASSIC350, LONAVALA]);

    await client.query(`
      INSERT INTO expenses (user_id, vehicle_id, ride_id, category, amount, date, description, type, payment_method) VALUES
        ($1,$2,$3,'Toll', 120,'2026-02-26','Mumbai-Pune Express toll','ride','cash'),
        ($1,$2,$3,'Fuel',1200,'2026-02-24','Group ride fuel',         'ride','upi'),
        ($1,$2,$3,'Food', 850,'2026-02-24','Dhaba meal',              'ride','cash'),
        ($1,$2,$3,'Toll', 240,'2026-02-21','Ghat section toll',       'ride','cash'),
        ($1,$2,$3,'Food', 650,'2026-02-08','Group breakfast',         'ride','cash'),
        ($1,$2,$3,'Fuel', 950,'2026-02-04','Weekend ride fuel',       'ride','upi')
    `, [RAHUL, CLASSIC350, PUNE_EXPRESS]);

    // Personal expenses (no ride_id — use NULL inline in SQL, not as param)
    await client.query(`
      INSERT INTO expenses (user_id, vehicle_id, category, amount, date, description, type, payment_method) VALUES
        ($1,$2,'Maintenance',3500,'2024-11-18','Chain adjustment and oil change','personal','upi'),
        ($1,$2,'Fuel',        850,'2026-02-26','Shell Petrol Pump',              'personal','upi'),
        ($1,$2,'Maintenance',2500,'2026-02-23','Oil change',                     'personal','card'),
        ($1,$2,'Fuel',        900,'2026-02-22','HP Petrol',                      'personal','upi'),
        ($1,$2,'Fuel',       1100,'2026-02-16','Indian Oil',                     'personal','upi'),
        ($1,$2,'Maintenance',1800,'2026-02-11','Brake pad replacement',          'personal','card'),
        ($1,$2,'Toll',        180,'2026-02-06','Highway toll',                   'personal','cash'),
        ($1,$2,'Other',       500,'2026-02-01','Bike wash',                      'personal','cash')
    `, [RAHUL, CLASSIC350]);
    console.log('  ✅ Expenses seeded');

    // ── ACCESSORIES — $1=user, $2=vehicle ──────────────────────────────────────
    await client.query(`
      INSERT INTO accessories (user_id, vehicle_id, name, brand, type, price, purchase_date, size, color, store, emoji) VALUES
        ($1,$2,'K6 S Helmet',              'AGV',           'Helmet',35000,'2024-01-15','L', 'Matte Black','BikeRyders Store, Mumbai','🪖'),
        ($1,$2,'T-GP Plus R v3 Air Jacket','Alpinestars',   'Jacket',28000,'2024-02-10','XL','Black/White', 'Amazon India',            '🧥'),
        ($1,$2,'Summer Gloves',            'Royal Enfield', 'Gloves', 2500,'2024-03-05','M', 'Brown',       'Royal Enfield Store',     '🧤'),
        ($1,$2,'Touring Boots',            'Alpinestars',   'Boots', 15000,'2024-04-12','42','Black',        'BikeRyders Store',        '🥾')
    `, [RAHUL, HIMALAYAN]);

    await client.query(`
      INSERT INTO accessories (user_id, vehicle_id, name, brand, type, price, purchase_date, color, store, emoji) VALUES
        ($1,$2,'Saddlebags Pro','ViaTerra','Bag',8500,'2024-05-20','Black','Amazon India','🎒')
    `, [RAHUL, CLASSIC350]);
    console.log('  ✅ Accessories seeded');

    // ── MARKETPLACE — $1=seller only ──────────────────────────────────────────
    await client.query(`
      INSERT INTO marketplace_listings
        (seller_id, title, description, price, condition, category, location, contact_pref, status,
         brand, model, year, km_driven, fuel_type, transmission, owners) VALUES
        ($1,'Royal Enfield Classic 350',
         'Well maintained Classic 350 in Stealth Black. Single owner, all service records available.',
         125000,'Like New','Bikes','Mumbai','Call Allowed','active',
         'Royal Enfield','Classic 350',2022,12000,'Petrol','Manual','1st')
    `, [RAHUL]);

    await client.query(`
      INSERT INTO marketplace_listings
        (seller_id, title, description, price, condition, category, location, contact_pref, status,
         brand, model, year, km_driven, fuel_type, transmission, owners) VALUES
        ($1,'Bajaj Pulsar NS200',
         'Sporty NS200 with recent service done. Minor scratch on left fairing.',
         85000,'Good','Bikes','Pune','Chat Only','active',
         'Bajaj','Pulsar NS200',2021,22000,'Petrol','Manual','2nd')
    `, [JOHN]);

    await client.query(`
      INSERT INTO marketplace_listings
        (seller_id, title, description, price, condition, category, location, contact_pref, status,
         gear_type, gear_size, gender, certification) VALUES
        ($1,'SMK Stellar Helmet',  'Barely used. Full-face with visor. Great condition.',4500,'New', 'Gear','Pune',     'Chat Only',   'active','Helmet','L', 'Men','ECE'),
        ($1,'Rynox Air GT Gloves', 'Mesh summer gloves. Used only 3 times.',             1800,'New', 'Gear','Bangalore','Call Allowed','active','Gloves','M', 'Men',NULL)
    `, [PRIYA]);

    await client.query(`
      INSERT INTO marketplace_listings
        (seller_id, title, description, price, condition, category, location, contact_pref, status,
         gear_type, gear_size, gender) VALUES
        ($1,'Leather Riding Jacket','CE level 2 armour. Premium leather jacket. Size XL.',8500,'Good','Gear','Mumbai','Chat Only','active','Jacket','XL','Men')
    `, [AMIT]);

    await client.query(`
      INSERT INTO marketplace_listings (seller_id, title, description, price, condition, category, location, contact_pref, status) VALUES
        ($1,'Saddle Bags Set',      'Weatherproof saddle bags, fits most bikes.',3200,'New', 'Accessories','Delhi',    'Chat Only',   'active'),
        ($1,'LED Fog Lights (Pair)','Universal fit LED fog lights with harness.',2400,'New', 'Parts',      'Hyderabad','Chat Only',   'active')
    `, [SANJAY]);

    await client.query(`
      INSERT INTO marketplace_listings (seller_id, title, description, price, condition, category, location, contact_pref, status) VALUES
        ($1,'Chain Tensioner Kit','Heavy duty kit. Fits RE, Dominar, and more.',1200,'Good','Parts','Chennai','Call Allowed','active')
    `, [NAIR]);
    console.log('  ✅ Marketplace listings seeded');

    await client.query('COMMIT');
    console.log('\n🎉 Database seeded successfully!');
    console.log('─────────────────────────────────────────');
    console.log('📧 Login: rahul@example.com');
    console.log('🔑 Pass:  password123');
    console.log('🌐 API:   http://localhost:3000/api/v1');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Seed failed:', err.message);
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

seed().catch(() => process.exit(1));
