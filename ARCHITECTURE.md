# CricketX — IPL Fantasy Platform
## Complete Project Structure, Architecture & Deployment Guide

---

## 📁 Project Structure

```
cricketx/
├── frontend/                    # Next.js App
│   ├── app/
│   │   ├── layout.tsx
│   │   ├── page.tsx             # Home (matches)
│   │   ├── auth/page.tsx        # Login/OTP
│   │   ├── match/[id]/
│   │   │   ├── page.tsx         # Match detail & contests
│   │   │   └── select-team/page.tsx
│   │   ├── leaderboard/[contestId]/page.tsx
│   │   ├── wallet/page.tsx
│   │   └── admin/page.tsx
│   ├── components/
│   │   ├── ui/                  # Shared UI components
│   │   ├── MatchCard.tsx
│   │   ├── PlayerCard.tsx
│   │   ├── Leaderboard.tsx
│   │   ├── WalletWidget.tsx
│   │   └── CountdownTimer.tsx
│   ├── lib/
│   │   ├── api.ts               # API client
│   │   ├── socket.ts            # Socket.io client
│   │   └── scoring.ts           # Points calculator (shared)
│   ├── store/                   # Zustand state management
│   │   ├── authStore.ts
│   │   ├── walletStore.ts
│   │   └── teamStore.ts
│   └── next.config.js
│
├── backend/                     # Node.js + Express
│   ├── server.js
│   ├── routes/
│   │   ├── auth.js
│   │   ├── matches.js
│   │   ├── contests.js
│   │   ├── teams.js
│   │   ├── wallet.js
│   │   ├── leaderboard.js
│   │   ├── scoring.js
│   │   ├── players.js
│   │   └── admin.js
│   ├── models/
│   │   ├── User.js
│   │   ├── Match.js
│   │   ├── Player.js
│   │   ├── Contest.js
│   │   ├── Team.js
│   │   └── Transaction.js
│   ├── middleware/
│   │   ├── auth.js
│   │   ├── admin.js
│   │   └── rateLimiter.js
│   ├── services/
│   │   ├── cricketApi.js        # RapidAPI integration
│   │   ├── antiCheat.js
│   │   ├── notifications.js     # FCM + SMS
│   │   └── winnerProcessor.js
│   ├── socket/
│   │   └── scoreUpdater.js
│   ├── jobs/                    # Cron jobs
│   │   ├── syncMatches.js       # Fetch upcoming IPL matches
│   │   ├── processWinners.js    # Auto-distribute prizes
│   │   └── lockContests.js      # Lock teams before match
│   └── tests/
│
├── docker-compose.yml
├── Dockerfile.frontend
├── Dockerfile.backend
└── README.md
```

---

## 🗄️ Database Schema (MongoDB)

### Users
```
_id, name, phone, email, wallet{balance, winnings, deposited},
stats{played, won, totalWinnings}, kycVerified, isFlagged, isAdmin
```

### Matches
```
_id, externalId, team1{name,shortName,color}, team2{...},
venue, matchDate, lockTime, status, scorecard
```

### Contests
```
_id, matchId, entryFee(₹1), maxEntries, totalEntries,
prizePool, prizeDistribution[{rank, prize}], status, platformCut(15%)
```

### Teams
```
_id, userId, contestId, matchId, players[11], captain, viceCaptain,
totalCreditsUsed, totalPoints, rank, winnings
```

### Transactions
```
_id, userId, type(deposit/withdrawal/entry/winning),
amount, balance, paymentId, status
```

---

## 🔌 API Reference

### Auth
```
POST /api/auth/send-otp     { phone }
POST /api/auth/verify-otp   { phone, otp }
GET  /api/auth/me           → user profile
```

### Matches
```
GET  /api/matches                      → upcoming/live matches
GET  /api/matches/:id                  → match detail
GET  /api/matches/:id/players          → players for team selection
```

### Contests
```
GET  /api/contests?matchId=:id         → contests for a match
POST /api/contests/:id/join            → join contest (deducts ₹1)
```

### Teams
```
POST /api/teams             { contestId, matchId, playerIds[11], captainId, viceCaptainId }
GET  /api/teams/my          → user's teams
```

### Wallet
```
GET  /api/wallet/balance               → current balance
GET  /api/wallet/transactions          → history
POST /api/wallet/create-order          → Razorpay order { amount }
POST /api/wallet/verify-payment        → { orderId, paymentId, signature }
```

### Leaderboard
```
GET  /api/leaderboard/:contestId       → ranked teams
GET  /api/leaderboard/:contestId/my-rank → user's rank
```

### Admin
```
GET  /api/admin/stats                  → platform stats
POST /api/admin/contests               → create contest
GET  /api/admin/users?flagged=true     → user management
POST /api/admin/process-winners/:id    → distribute prizes
POST /api/scoring/calculate            → update player points
```

---

## ⚡ Scoring System

| Event              | Points |
|--------------------|--------|
| Run scored         | +1     |
| 4 hit              | +1     |
| 6 hit              | +2     |
| 50 runs            | +8     |
| 100 runs           | +16    |
| Duck               | -2     |
| Wicket             | +25    |
| Maiden over        | +8     |
| 3+ wickets         | +4     |
| 5+ wickets         | +8     |
| Catch              | +8     |
| Stumping           | +12    |
| Run out            | +6     |
| SR > 170 (10+ balls)| +6   |
| Economy < 5 (2+ ov) | +6   |

**Captain** = 2× points | **Vice-captain** = 1.5× points

---

## 🏆 Prize Distribution (Default ₹1 Pool)

| Rank  | Prize  |
|-------|--------|
| 1st   | 30%    |
| 2nd   | 20%    |
| 3rd   | 10%    |
| 4–10  | 5% split |
| Rest  | No prize |

Platform takes **15%** of pool.

---

## 🐳 Docker Deployment

### docker-compose.yml
```yaml
version: '3.8'
services:
  frontend:
    build:
      context: ./frontend
      dockerfile: ../Dockerfile.frontend
    ports: ["3000:3000"]
    environment:
      - NEXT_PUBLIC_API_URL=http://backend:5000
      - NEXT_PUBLIC_SOCKET_URL=http://backend:5000
    depends_on: [backend]

  backend:
    build:
      context: ./backend
      dockerfile: ../Dockerfile.backend
    ports: ["5000:5000"]
    environment:
      - MONGODB_URI=${MONGODB_URI}
      - JWT_SECRET=${JWT_SECRET}
      - RAPIDAPI_KEY=${RAPIDAPI_KEY}
      - RAZORPAY_KEY_ID=${RAZORPAY_KEY_ID}
      - RAZORPAY_SECRET=${RAZORPAY_SECRET}
    depends_on: [mongo, redis]

  mongo:
    image: mongo:7
    volumes: [mongo_data:/data/db]
    ports: ["27017:27017"]

  redis:
    image: redis:7-alpine
    ports: ["6379:6379"]

  nginx:
    image: nginx:alpine
    ports: ["80:80", "443:443"]
    volumes:
      - ./nginx.conf:/etc/nginx/nginx.conf
      - ./ssl:/etc/ssl
    depends_on: [frontend, backend]

volumes:
  mongo_data:
```

### Dockerfile.backend
```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY . .
EXPOSE 5000
CMD ["node", "server.js"]
```

### Dockerfile.frontend
```dockerfile
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:20-alpine
WORKDIR /app
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/node_modules ./node_modules
COPY package*.json ./
EXPOSE 3000
CMD ["npm", "start"]
```

---

## ☁️ Cloud Deployment (AWS / GCP)

### Recommended Stack
```
Route 53 (DNS)
    ↓
CloudFront (CDN + SSL)
    ↓
ALB (Load Balancer)
    ↓
ECS Fargate (containers)
    ├── Frontend (Next.js) — 2 tasks
    └── Backend (Express) — 2 tasks
        ↓
MongoDB Atlas (M10+ cluster)
ElastiCache Redis
```

### Quick Deploy Script
```bash
# 1. Build and push images
docker build -t cricketx-backend ./backend
docker build -t cricketx-frontend ./frontend

docker tag cricketx-backend:latest <ecr-uri>/cricketx-backend:latest
docker tag cricketx-frontend:latest <ecr-uri>/cricketx-frontend:latest

docker push <ecr-uri>/cricketx-backend:latest
docker push <ecr-uri>/cricketx-frontend:latest

# 2. Deploy to ECS
aws ecs update-service --cluster cricketx --service backend --force-new-deployment
aws ecs update-service --cluster cricketx --service frontend --force-new-deployment

# 3. Or use Docker Compose on a single VPS (DigitalOcean / Hetzner)
docker-compose -f docker-compose.prod.yml up -d --build
```

---

## 🔐 Security Checklist

- [x] JWT with 30-day expiry + refresh tokens
- [x] OTP rate limiting (5 attempts per 10 min)
- [x] Razorpay signature verification for payments
- [x] MongoDB transactions for wallet operations (atomic)
- [x] Helmet.js security headers
- [x] IP logging + multi-account detection
- [x] Win rate anomaly detection (>80% flags user)
- [x] Admin-only routes with middleware guard
- [x] Input validation on all team selection constraints
- [x] CORS whitelist for production domains
- [ ] KYC verification for withdrawals > ₹10,000
- [ ] 2FA for admin accounts
- [ ] WAF (CloudFlare) for DDoS protection

---

## 🎯 Cron Jobs

```javascript
// Sync IPL matches from API — daily at 6 AM
cron.schedule('0 6 * * *', syncMatchesJob);

// Lock contests 30 min before match start
cron.schedule('*/5 * * * *', lockContestsJob);

// Process winners after match completion
cron.schedule('*/15 * * * *', processWinnersJob);

// Send push notifications for upcoming matches
cron.schedule('0 18 * * *', matchReminderJob);
```

---

## 📱 Frontend Tech Stack

```json
{
  "framework": "Next.js 14 (App Router)",
  "styling": "Tailwind CSS + custom CSS vars",
  "state": "Zustand",
  "realtime": "Socket.io-client",
  "payments": "Razorpay React SDK",
  "animations": "Framer Motion",
  "http": "Axios + React Query",
  "auth": "JWT in localStorage + httpOnly cookies"
}
```

---

## 🚀 Getting Started (Local Dev)

```bash
# Clone & install
git clone https://github.com/yourorg/cricketx
cd cricketx

# Backend
cd backend && cp .env.example .env
npm install && npm run dev

# Frontend (new terminal)
cd frontend && cp .env.example .env.local
npm install && npm run dev

# Or with Docker
docker-compose up --build
```

Visit: `http://localhost:3000` (frontend) · `http://localhost:5000` (API)

---

## 📊 Scalability Notes

- **Horizontal scaling**: Backend is stateless — scale ECS tasks behind ALB
- **Redis**: Cache leaderboards, match data, OTP — reduces DB load 70%+
- **MongoDB sharding**: Shard `teams` collection by `matchId` for large contests
- **CDN**: Serve player images via CloudFront (S3 origin)
- **WebSockets**: Socket.io with Redis adapter for multi-instance pub/sub

---

*CricketX — Built for scale. Designed for winners.* 🏆
