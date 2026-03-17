# BikerApp API — Node.js + PostgreSQL

## Quick Start

### 1. Install Dependencies
```bash
npm install
```

### 2. Configure Environment
```bash
cp .env.example .env
# Edit .env with your PostgreSQL credentials
```

### 3. Create PostgreSQL Database
```bash
psql -U postgres -c "CREATE DATABASE bikerapp;"
```

### 4. Run Migrations (creates all tables)
```bash
npm run db:migrate
```

### 5. Seed Database (loads sample data)
```bash
npm run db:seed
```

### 6. Start Server
```bash
# Development (with auto-reload)
npm run dev

# Production
npm start
```

Server runs at: **http://localhost:3000**

---

## API Endpoints

### Auth
| Method | Endpoint         | Description           |
|--------|------------------|-----------------------|
| POST   | /api/auth/register | Register new user   |
| POST   | /api/auth/login    | Login               |
| GET    | /api/auth/me       | Get current user    |
| PUT    | /api/auth/me       | Update profile      |

**All endpoints below require `Authorization: Bearer <token>` header.**

---

### Rides
| Method | Endpoint                            | Description                          |
|--------|-------------------------------------|--------------------------------------|
| GET    | /api/rides                          | List rides (`?tab=upcoming/past/my_rides`) |
| GET    | /api/rides/:id                      | Get ride details (+ waypoints, participants, expenses) |
| POST   | /api/rides                          | Create ride                          |
| PUT    | /api/rides/:id                      | Update ride                          |
| DELETE | /api/rides/:id                      | Delete ride                          |
| POST   | /api/rides/:id/join                 | Send join request                    |
| POST   | /api/rides/:id/clone                | Clone a ride                         |
| PUT    | /api/rides/:id/status               | Update ride status                   |
| GET    | /api/rides/:id/participants         | Get all participants                 |
| GET    | /api/rides/:id/requests             | Get join requests (host only)        |
| PUT    | /api/rides/:id/requests/:requestId  | Approve/reject join request          |
| GET    | /api/rides/:id/waypoints            | Get waypoints                        |
| POST   | /api/rides/:id/expenses             | Add expense to ride                  |
| POST   | /api/rides/:id/favourite-location   | Save location during active ride     |

---

### Groups
| Method | Endpoint                     | Description           |
|--------|------------------------------|-----------------------|
| GET    | /api/groups                  | List groups           |
| GET    | /api/groups/:id              | Group detail + members + rules + chat |
| POST   | /api/groups                  | Create group          |
| PUT    | /api/groups/:id              | Update group          |
| POST   | /api/groups/:id/join         | Join group            |
| DELETE | /api/groups/:id/leave        | Leave group           |
| GET    | /api/groups/:id/messages     | Get chat messages     |
| POST   | /api/groups/:id/messages     | Send chat message     |
| GET    | /api/groups/:id/rules        | Get group rules       |
| POST   | /api/groups/:id/rules        | Add rule              |
| DELETE | /api/groups/:id/rules/:ruleId| Delete rule           |

---

### Expenses
| Method | Endpoint          | Description                      |
|--------|-------------------|----------------------------------|
| GET    | /api/expenses     | List expenses (`?type=personal/ride&category=Fuel`) |
| GET    | /api/expenses/stats| Monthly stats breakdown         |
| GET    | /api/expenses/:id | Get expense                      |
| POST   | /api/expenses     | Create expense                   |
| PUT    | /api/expenses/:id | Update expense                   |
| DELETE | /api/expenses/:id | Delete expense                   |

---

### Vehicles
| Method | Endpoint          | Description    |
|--------|-------------------|----------------|
| GET    | /api/vehicles     | List vehicles  |
| GET    | /api/vehicles/:id | Get vehicle    |
| POST   | /api/vehicles     | Add vehicle    |
| PUT    | /api/vehicles/:id | Update vehicle |
| DELETE | /api/vehicles/:id | Delete vehicle |

---

### Accessories
| Method | Endpoint            | Description       |
|--------|---------------------|-------------------|
| GET    | /api/accessories    | List accessories  |
| GET    | /api/accessories/:id| Get accessory     |
| POST   | /api/accessories    | Add accessory     |
| PUT    | /api/accessories/:id| Update accessory  |
| DELETE | /api/accessories/:id| Delete accessory  |

---

### Marketplace
| Method | Endpoint                    | Description        |
|--------|-----------------------------|--------------------|
| GET    | /api/marketplace            | List listings      |
| GET    | /api/marketplace/:id        | Get listing        |
| POST   | /api/marketplace            | Create listing     |
| PUT    | /api/marketplace/:id        | Update listing     |
| DELETE | /api/marketplace/:id        | Delete listing     |
| PUT    | /api/marketplace/:id/mark-sold | Mark as sold   |

---

### SOS
| Method | Endpoint              | Description      |
|--------|-----------------------|------------------|
| POST   | /api/sos              | Trigger SOS      |
| GET    | /api/sos/my           | My SOS history   |
| PUT    | /api/sos/:id/resolve  | Resolve SOS      |

---

## Database Schema
All 14 tables:
- `users` — user profiles
- `vehicles` — bikes/cars owned by users
- `rides` — ride events
- `ride_waypoints` — route stops per ride
- `ride_participants` — who joined each ride
- `ride_weather` — weather info per ride
- `ride_expenses` — expenses during a ride
- `ride_requests` — join requests
- `groups` — biker groups
- `group_members` — group membership
- `group_rules` — rules per group
- `group_messages` — group chat
- `expenses` — personal expense tracker
- `accessories` — riding gear inventory
- `marketplace_listings` — buy/sell listings
- `sos_alerts` — emergency SOS
- `favourite_locations` — saved locations

---

## Example Requests

### Register
```bash
curl -X POST http://localhost:3000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"name":"Rahul","email":"rahul@test.com","password":"password123"}'
```

### Get Rides (Upcoming tab)
```bash
curl http://localhost:3000/api/rides?tab=upcoming \
  -H "Authorization: Bearer YOUR_TOKEN"
```

### Create Ride
```bash
curl -X POST http://localhost:3000/api/rides \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Himalayan Adventure",
    "source": "Delhi",
    "destination": "Leh",
    "start_date": "2026-04-05",
    "start_time": "06:00:00",
    "distance_km": 9999,
    "duration_hrs": 90,
    "ride_type": "Public",
    "is_paid": true,
    "entry_fee": 2000,
    "max_participants": 15,
    "tags": ["Public", "Paid", "Scenic"],
    "scenic": true,
    "waypoints": [
      {"name":"Delhi","stop_time":"6:00 AM","type":"start"},
      {"name":"Manali","stop_time":"Day 3 PM","type":"stop"},
      {"name":"Leh","stop_time":"Day 10","type":"end"}
    ]
  }'
```
