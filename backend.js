// ============================================================
// CricketX Fantasy Platform — Full Backend (Node.js + Express)
// ============================================================

// ─── server.js ───────────────────────────────────────────────
const express = require('express');
const http = require('http');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const mongoose = require('mongoose');
const socketIo = require('socket.io');
const jwt = require('jsonwebtoken');
require('dotenv').config();

const app = express();
const server = http.createServer(app);
const io = socketIo(server, { cors: { origin: '*' } });

// ── Middleware ──
app.use(helmet());
app.use(cors({ origin: process.env.ALLOWED_ORIGINS?.split(',') || '*' }));
app.use(express.json());
app.use(morgan('combined'));

// ── DB Connection ──
mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/cricketx', {
  useNewUrlParser: true, useUnifiedTopology: true
}).then(() => console.log('✅ MongoDB connected'))
  .catch(err => console.error('❌ MongoDB error:', err));

// ── Routes ──
app.use('/api/auth',      require('./routes/auth'));
app.use('/api/matches',   require('./routes/matches'));
app.use('/api/contests',  require('./routes/contests'));
app.use('/api/teams',     require('./routes/teams'));
app.use('/api/wallet',    require('./routes/wallet'));
app.use('/api/leaderboard', require('./routes/leaderboard'));
app.use('/api/admin',     require('./routes/admin'));
app.use('/api/players',   require('./routes/players'));
app.use('/api/scoring',   require('./routes/scoring'));

// ── Socket.io Real-time ──
require('./socket/scoreUpdater')(io);

// ── Health check ──
app.get('/health', (_, res) => res.json({ status: 'ok', ts: new Date() }));

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
module.exports = { app, io };


// ============================================================
// MODELS
// ============================================================

// ─── models/User.js ──────────────────────────────────────────
const userSchema = new mongoose.Schema({
  name:       { type: String, required: true, trim: true },
  phone:      { type: String, unique: true, sparse: true },
  email:      { type: String, unique: true, sparse: true, lowercase: true },
  avatar:     String,
  wallet: {
    balance:   { type: Number, default: 0, min: 0 },
    winnings:  { type: Number, default: 0 },
    deposited: { type: Number, default: 0 }
  },
  stats: {
    contestsPlayed: { type: Number, default: 0 },
    contestsWon:    { type: Number, default: 0 },
    totalWinnings:  { type: Number, default: 0 }
  },
  kycVerified:  { type: Boolean, default: false },
  isFlagged:    { type: Boolean, default: false },
  isAdmin:      { type: Boolean, default: false },
  isActive:     { type: Boolean, default: true },
  otp:          String,
  otpExpiry:    Date,
  lastLogin:    Date,
  ipHistory:    [String],
  deviceTokens: [String]
}, { timestamps: true });

// ─── models/Match.js ─────────────────────────────────────────
const matchSchema = new mongoose.Schema({
  externalId:  String,          // from Cricket API
  team1: { name: String, shortName: String, logo: String, color: String },
  team2: { name: String, shortName: String, logo: String, color: String },
  venue:       String,
  matchDate:   Date,
  lockTime:    Date,            // team selection closes
  status:      { type: String, enum: ['upcoming','live','completed','cancelled'], default: 'upcoming' },
  result:      String,
  scorecard: {
    team1: { runs: Number, wickets: Number, overs: String },
    team2: { runs: Number, wickets: Number, overs: String }
  },
  series:      { type: String, default: 'IPL 2025' }
}, { timestamps: true });

// ─── models/Player.js ────────────────────────────────────────
const playerSchema = new mongoose.Schema({
  externalId:  String,
  name:        { type: String, required: true },
  team:        String,
  role:        { type: String, enum: ['BAT','BOWL','AR','WK'], required: true },
  credits:     { type: Number, required: true },
  avatar:      String,
  country:     String,
  battingStyle: String,
  bowlingStyle: String,
  stats: {
    recentForm:  [Number],        // last 5 match points
    avgPoints:   Number,
    totalPoints: Number
  },
  matchPerformances: [{
    matchId:   mongoose.Schema.Types.ObjectId,
    points:    Number,
    breakdown: mongoose.Schema.Types.Mixed
  }]
}, { timestamps: true });

// ─── models/Contest.js ───────────────────────────────────────
const contestSchema = new mongoose.Schema({
  matchId:    { type: mongoose.Schema.Types.ObjectId, ref: 'Match', required: true },
  name:       String,
  entryFee:   { type: Number, default: 1 },
  maxEntries: { type: Number, required: true },
  totalEntries: { type: Number, default: 0 },
  prizePool:  Number,
  prizeDistribution: [{
    rank:       Number,
    rankEnd:    Number,             // for ranges (e.g. rank 4-10)
    prize:      Number,
    percentage: Number
  }],
  status:     { type: String, enum: ['open','locked','live','completed'], default: 'open' },
  winnersProcessed: { type: Boolean, default: false },
  platformCut: { type: Number, default: 0.15 }   // 15% platform fee
}, { timestamps: true });

// ─── models/Team.js ──────────────────────────────────────────
const teamSchema = new mongoose.Schema({
  userId:    { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  contestId: { type: mongoose.Schema.Types.ObjectId, ref: 'Contest', required: true },
  matchId:   { type: mongoose.Schema.Types.ObjectId, ref: 'Match', required: true },
  players:   [{ type: mongoose.Schema.Types.ObjectId, ref: 'Player' }],
  captain:   { type: mongoose.Schema.Types.ObjectId, ref: 'Player', required: true },
  viceCaptain: { type: mongoose.Schema.Types.ObjectId, ref: 'Player', required: true },
  totalCreditsUsed: Number,
  totalPoints: { type: Number, default: 0 },
  rank:      Number,
  winnings:  { type: Number, default: 0 }
}, { timestamps: true });
teamSchema.index({ userId: 1, contestId: 1 }, { unique: true });

// ─── models/Transaction.js ───────────────────────────────────
const txnSchema = new mongoose.Schema({
  userId:    { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  type:      { type: String, enum: ['deposit','withdrawal','contest_entry','winning','refund'], required: true },
  amount:    { type: Number, required: true },
  balance:   Number,              // balance after transaction
  description: String,
  contestId: { type: mongoose.Schema.Types.ObjectId, ref: 'Contest' },
  matchId:   { type: mongoose.Schema.Types.ObjectId, ref: 'Match' },
  paymentId: String,              // Razorpay order/payment ID
  status:    { type: String, enum: ['pending','success','failed'], default: 'success' }
}, { timestamps: true });


// ============================================================
// MIDDLEWARE
// ============================================================

// ─── middleware/auth.js ──────────────────────────────────────
const authMiddleware = async (req, res, next) => {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (!token) return res.status(401).json({ error: 'No token provided' });
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const User = mongoose.model('User');
    const user = await User.findById(decoded.id).select('-otp -otpExpiry');
    if (!user || !user.isActive) return res.status(401).json({ error: 'Unauthorized' });
    req.user = user;
    next();
  } catch (err) {
    res.status(401).json({ error: 'Invalid token' });
  }
};

const adminMiddleware = (req, res, next) => {
  if (!req.user?.isAdmin) return res.status(403).json({ error: 'Admin access required' });
  next();
};

// ─── middleware/rateLimiter.js ───────────────────────────────
const rateLimit = require('express-rate-limit');
const otpLimiter = rateLimit({ windowMs: 10*60*1000, max: 5, message: 'Too many OTP requests' });
const apiLimiter = rateLimit({ windowMs: 15*60*1000, max: 100 });


// ============================================================
// ROUTES
// ============================================================

// ─── routes/auth.js ──────────────────────────────────────────
/*
POST /api/auth/send-otp   { phone }
POST /api/auth/verify-otp { phone, otp }
POST /api/auth/login      { email, password }
GET  /api/auth/me         (protected)
*/
const authRouter = express.Router();
const twilio = require('twilio')(process.env.TWILIO_SID, process.env.TWILIO_TOKEN);

authRouter.post('/send-otp', otpLimiter, async (req, res) => {
  const { phone } = req.body;
  if (!phone) return res.status(400).json({ error: 'Phone required' });
  const otp = Math.floor(1000 + Math.random() * 9000).toString();
  const otpExpiry = new Date(Date.now() + 10 * 60 * 1000); // 10 min
  await User.findOneAndUpdate(
    { phone }, { otp, otpExpiry }, { upsert: true, new: true, setDefaultsOnInsert: true }
  );
  // In production: await twilio.messages.create({ body: `CricketX OTP: ${otp}`, from: process.env.TWILIO_PHONE, to: phone });
  console.log(`OTP for ${phone}: ${otp}`); // dev only
  res.json({ success: true, message: 'OTP sent' });
});

authRouter.post('/verify-otp', async (req, res) => {
  const { phone, otp } = req.body;
  const user = await User.findOne({ phone });
  if (!user || user.otp !== otp || user.otpExpiry < new Date())
    return res.status(400).json({ error: 'Invalid or expired OTP' });
  user.otp = undefined; user.otpExpiry = undefined; user.lastLogin = new Date();
  user.ipHistory = [...(user.ipHistory || []).slice(-9), req.ip];
  await user.save();
  const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET, { expiresIn: '30d' });
  res.json({ token, user: { id: user._id, name: user.name, phone, wallet: user.wallet } });
});

authRouter.get('/me', authMiddleware, (req, res) => {
  res.json({ user: req.user });
});


// ─── routes/matches.js ───────────────────────────────────────
/*
GET /api/matches              — all upcoming/live
GET /api/matches/:id          — single match detail
GET /api/matches/:id/players  — eligible players for match
*/
const matchRouter = express.Router();

matchRouter.get('/', async (req, res) => {
  const matches = await Match.find({ status: { $in: ['upcoming','live'] } })
    .sort('matchDate').lean();
  res.json(matches);
});

matchRouter.get('/:id', async (req, res) => {
  const match = await Match.findById(req.params.id).lean();
  if (!match) return res.status(404).json({ error: 'Match not found' });
  res.json(match);
});

matchRouter.get('/:id/players', async (req, res) => {
  const match = await Match.findById(req.params.id);
  if (!match) return res.status(404).json({ error: 'Match not found' });
  const players = await Player.find({
    team: { $in: [match.team1.shortName, match.team2.shortName] }
  }).select('-matchPerformances').lean();
  res.json(players);
});


// ─── routes/contests.js ──────────────────────────────────────
const contestRouter = express.Router();

contestRouter.get('/', async (req, res) => {
  const { matchId } = req.query;
  const filter = matchId ? { matchId, status: { $in: ['open','live'] } } : { status: 'open' };
  const contests = await Contest.find(filter).populate('matchId').lean();
  res.json(contests);
});

contestRouter.post('/:id/join', authMiddleware, async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const contest = await Contest.findById(req.params.id).session(session);
    if (!contest || contest.status !== 'open') throw new Error('Contest not available');
    if (contest.totalEntries >= contest.maxEntries) throw new Error('Contest full');

    const user = await User.findById(req.user._id).session(session);
    if (user.wallet.balance < contest.entryFee) throw new Error('Insufficient balance');

    // Deduct entry fee
    user.wallet.balance -= contest.entryFee;
    await user.save({ session });

    // Record transaction
    await Transaction.create([{
      userId: user._id, type: 'contest_entry', amount: -contest.entryFee,
      balance: user.wallet.balance, description: 'Contest entry fee',
      contestId: contest._id, matchId: contest.matchId
    }], { session });

    contest.totalEntries += 1;
    contest.prizePool = contest.totalEntries * contest.entryFee * (1 - contest.platformCut);
    await contest.save({ session });

    await session.commitTransaction();
    res.json({ success: true, newBalance: user.wallet.balance });
  } catch (err) {
    await session.abortTransaction();
    res.status(400).json({ error: err.message });
  } finally {
    session.endSession();
  }
});


// ─── routes/teams.js ─────────────────────────────────────────
const teamRouter = express.Router();

teamRouter.post('/', authMiddleware, async (req, res) => {
  const { contestId, matchId, playerIds, captainId, viceCaptainId } = req.body;

  // Validate team
  if (playerIds?.length !== 11) return res.status(400).json({ error: 'Select exactly 11 players' });
  if (!playerIds.includes(captainId) || !playerIds.includes(viceCaptainId))
    return res.status(400).json({ error: 'Captain/VC must be in selected players' });

  const players = await Player.find({ _id: { $in: playerIds } });
  const totalCredits = players.reduce((sum, p) => sum + p.credits, 0);
  if (totalCredits > 100) return res.status(400).json({ error: 'Exceeds 100 credit limit' });

  // Role constraints: min 1 WK, 3 BAT, 1 AR, 3 BOWL
  const roleCounts = players.reduce((acc, p) => { acc[p.role] = (acc[p.role]||0)+1; return acc; }, {});
  if ((roleCounts.WK||0)<1) return res.status(400).json({ error: 'Min 1 wicket-keeper required' });
  if ((roleCounts.BAT||0)<3) return res.status(400).json({ error: 'Min 3 batters required' });
  if ((roleCounts.BOWL||0)<3) return res.status(400).json({ error: 'Min 3 bowlers required' });

  // Max 7 players from one team
  const teamCounts = players.reduce((acc, p) => { acc[p.team] = (acc[p.team]||0)+1; return acc; }, {});
  if (Math.max(...Object.values(teamCounts)) > 7)
    return res.status(400).json({ error: 'Max 7 players from one team' });

  const team = new Team({
    userId: req.user._id, contestId, matchId,
    players: playerIds, captain: captainId, viceCaptain: viceCaptainId,
    totalCreditsUsed: totalCredits
  });
  await team.save();
  res.json({ success: true, team });
});

teamRouter.get('/my', authMiddleware, async (req, res) => {
  const teams = await Team.find({ userId: req.user._id })
    .populate('players captain viceCaptain matchId contestId').lean();
  res.json(teams);
});


// ─── routes/wallet.js ────────────────────────────────────────
const Razorpay = require('razorpay');
const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_SECRET
});

const walletRouter = express.Router();

walletRouter.get('/balance', authMiddleware, async (req, res) => {
  const user = await User.findById(req.user._id).select('wallet');
  res.json(user.wallet);
});

walletRouter.get('/transactions', authMiddleware, async (req, res) => {
  const txns = await Transaction.find({ userId: req.user._id })
    .sort('-createdAt').limit(50).lean();
  res.json(txns);
});

walletRouter.post('/create-order', authMiddleware, async (req, res) => {
  const { amount } = req.body;  // in rupees
  if (amount < 10) return res.status(400).json({ error: 'Min ₹10 required' });
  const order = await razorpay.orders.create({
    amount: amount * 100,  // paise
    currency: 'INR',
    receipt: `rcpt_${Date.now()}`,
    notes: { userId: req.user._id.toString() }
  });
  res.json({ orderId: order.id, amount, currency: 'INR' });
});

walletRouter.post('/verify-payment', authMiddleware, async (req, res) => {
  const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;
  const crypto = require('crypto');
  const hmac = crypto.createHmac('sha256', process.env.RAZORPAY_SECRET);
  hmac.update(`${razorpay_order_id}|${razorpay_payment_id}`);
  const digest = hmac.digest('hex');
  if (digest !== razorpay_signature)
    return res.status(400).json({ error: 'Payment verification failed' });

  const order = await razorpay.orders.fetch(razorpay_order_id);
  const amount = order.amount / 100;

  const user = await User.findByIdAndUpdate(req.user._id, {
    $inc: { 'wallet.balance': amount, 'wallet.deposited': amount }
  }, { new: true });

  await Transaction.create({
    userId: req.user._id, type: 'deposit', amount,
    balance: user.wallet.balance, description: 'UPI Deposit',
    paymentId: razorpay_payment_id, status: 'success'
  });

  res.json({ success: true, newBalance: user.wallet.balance });
});


// ─── routes/leaderboard.js ───────────────────────────────────
const lbRouter = express.Router();

lbRouter.get('/:contestId', async (req, res) => {
  const teams = await Team.find({ contestId: req.params.contestId })
    .populate('userId', 'name avatar')
    .sort('-totalPoints').lean();
  const ranked = teams.map((t, i) => ({ ...t, rank: i + 1 }));
  res.json(ranked);
});

lbRouter.get('/:contestId/my-rank', authMiddleware, async (req, res) => {
  const team = await Team.findOne({ contestId: req.params.contestId, userId: req.user._id });
  if (!team) return res.status(404).json({ error: 'Team not found' });
  const above = await Team.countDocuments({
    contestId: req.params.contestId, totalPoints: { $gt: team.totalPoints }
  });
  res.json({ rank: above + 1, points: team.totalPoints });
});


// ─── routes/scoring.js ───────────────────────────────────────
const scoringRouter = express.Router();

// Scoring rules (configurable by admin)
const DEFAULT_RULES = {
  run: 1, boundary4: 1, boundary6: 2, half_century: 8, century: 16,
  wicket: 25, maiden_over: 8, three_wickets: 4, five_wickets: 8,
  catch: 8, stumping: 12, run_out: 6,
  duck: -2, sr_bonus: 6, economy_bonus: 6
};

function calculatePoints(performance, rules = DEFAULT_RULES) {
  let pts = 0;
  const { batting, bowling, fielding } = performance;
  if (batting) {
    pts += batting.runs * rules.run;
    pts += batting.fours * rules.boundary4;
    pts += batting.sixes * rules.boundary6;
    if (batting.runs >= 50) pts += rules.half_century;
    if (batting.runs >= 100) pts += rules.century;
    if (batting.runs === 0 && batting.balls > 0) pts += rules.duck;
    if (batting.strikeRate >= 170 && batting.balls >= 10) pts += rules.sr_bonus;
  }
  if (bowling) {
    pts += bowling.wickets * rules.wicket;
    pts += bowling.maidens * rules.maiden_over;
    if (bowling.wickets >= 3) pts += rules.three_wickets;
    if (bowling.wickets >= 5) pts += rules.five_wickets;
    if (bowling.economy <= 5 && bowling.overs >= 2) pts += rules.economy_bonus;
  }
  if (fielding) {
    pts += (fielding.catches || 0) * rules.catch;
    pts += (fielding.stumpings || 0) * rules.stumping;
    pts += (fielding.runOuts || 0) * rules.run_out;
  }
  return pts;
}

scoringRouter.post('/calculate', authMiddleware, adminMiddleware, async (req, res) => {
  const { matchId, performances } = req.body;
  const results = {};
  for (const perf of performances) {
    results[perf.playerId] = calculatePoints(perf);
  }
  // Update player points and recalculate team totals
  for (const [playerId, pts] of Object.entries(results)) {
    await Player.findByIdAndUpdate(playerId, {
      $push: { 'matchPerformances': { matchId, points: pts } }
    });
  }
  // Recalculate all teams for this match
  const teams = await Team.find({ matchId }).populate('players captain viceCaptain');
  for (const team of teams) {
    let total = 0;
    for (const player of team.players) {
      let pts = results[player._id.toString()] || 0;
      if (team.captain._id.equals(player._id)) pts *= 2;
      else if (team.viceCaptain._id.equals(player._id)) pts *= 1.5;
      total += pts;
    }
    team.totalPoints = total;
    await team.save();
  }
  // Emit real-time update
  require('./server').io.to(`match_${matchId}`).emit('score_update', { matchId, results });
  res.json({ success: true, results });
});


// ─── routes/admin.js ─────────────────────────────────────────
const adminRouter = express.Router();
adminRouter.use(authMiddleware, adminMiddleware);

adminRouter.get('/stats', async (req, res) => {
  const [users, contests, txns] = await Promise.all([
    User.countDocuments(), Contest.countDocuments(),
    Transaction.aggregate([{ $group: { _id: null, total: { $sum: '$amount' } } }])
  ]);
  res.json({ users, contests, totalVolume: txns[0]?.total || 0 });
});

adminRouter.post('/contests', async (req, res) => {
  const contest = new Contest(req.body);
  await contest.save();
  res.json(contest);
});

adminRouter.get('/users', async (req, res) => {
  const { page=1, limit=20, flagged } = req.query;
  const filter = flagged ? { isFlagged: true } : {};
  const users = await User.find(filter).select('-otp -otpExpiry')
    .sort('-createdAt').skip((page-1)*limit).limit(Number(limit)).lean();
  const total = await User.countDocuments(filter);
  res.json({ users, total, pages: Math.ceil(total/limit) });
});

adminRouter.post('/process-winners/:contestId', async (req, res) => {
  const contest = await Contest.findById(req.params.contestId);
  if (!contest || contest.winnersProcessed)
    return res.status(400).json({ error: 'Already processed or invalid' });
  const teams = await Team.find({ contestId: contest._id })
    .populate('userId').sort('-totalPoints');
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    for (let i = 0; i < teams.length; i++) {
      const dist = contest.prizeDistribution.find(d => i+1 >= d.rank && i+1 <= (d.rankEnd||d.rank));
      if (!dist) continue;
      const prize = dist.prize || (contest.prizePool * dist.percentage / 100);
      await User.findByIdAndUpdate(teams[i].userId._id, {
        $inc: { 'wallet.balance': prize, 'wallet.winnings': prize, 'stats.totalWinnings': prize }
      }, { session });
      await Transaction.create([{
        userId: teams[i].userId._id, type: 'winning', amount: prize,
        description: `Contest winnings — Rank #${i+1}`, contestId: contest._id
      }], { session });
      teams[i].rank = i + 1; teams[i].winnings = prize;
      await teams[i].save({ session });
    }
    contest.status = 'completed'; contest.winnersProcessed = true;
    await contest.save({ session });
    await session.commitTransaction();
    res.json({ success: true, totalWinners: teams.filter(t=>t.winnings>0).length });
  } catch (err) {
    await session.abortTransaction();
    res.status(500).json({ error: err.message });
  } finally { session.endSession(); }
});


// ============================================================
// SOCKET.IO — REAL-TIME SCORE UPDATER
// ============================================================

// ─── socket/scoreUpdater.js ──────────────────────────────────
module.exports = function(io) {
  io.on('connection', socket => {
    console.log(`Socket connected: ${socket.id}`);

    socket.on('join_match', matchId => {
      socket.join(`match_${matchId}`);
      console.log(`Socket ${socket.id} joined match_${matchId}`);
    });

    socket.on('leave_match', matchId => socket.leave(`match_${matchId}`));
    socket.on('disconnect', () => console.log(`Socket disconnected: ${socket.id}`));
  });

  // Poll Cricket API every 30 seconds during live matches
  setInterval(async () => {
    const liveMatches = await Match.find({ status: 'live' });
    for (const match of liveMatches) {
      try {
        const data = await fetchCricketData(match.externalId);
        io.to(`match_${match._id}`).emit('live_score', data);
      } catch (err) { console.error('Score fetch error:', err.message); }
    }
  }, 30000);
};


// ============================================================
// CRICKET API INTEGRATION
// ============================================================

// ─── services/cricketApi.js ──────────────────────────────────
const axios = require('axios');

const CRICKET_API_BASE = 'https://cricbuzz-cricket.p.rapidapi.com';
const HEADERS = {
  'X-RapidAPI-Key': process.env.RAPIDAPI_KEY,
  'X-RapidAPI-Host': 'cricbuzz-cricket.p.rapidapi.com'
};

async function fetchCricketData(matchId) {
  const res = await axios.get(`${CRICKET_API_BASE}/mcenter/v1/${matchId}`, { headers: HEADERS });
  return transformMatchData(res.data);
}

async function fetchIPLMatches() {
  const res = await axios.get(`${CRICKET_API_BASE}/series/v1/3717/matches`, { headers: HEADERS });
  return res.data.matchDetails?.map(m => ({
    externalId: m.matchInfo?.matchId,
    team1: { name: m.matchInfo?.team1?.teamName, shortName: m.matchInfo?.team1?.teamSName },
    team2: { name: m.matchInfo?.team2?.teamName, shortName: m.matchInfo?.team2?.teamSName },
    venue: m.matchInfo?.venueInfo?.ground,
    matchDate: new Date(m.matchInfo?.startDate)
  })) || [];
}

function transformMatchData(raw) {
  return {
    matchId: raw.matchInfo?.matchId,
    status: raw.matchInfo?.state,
    team1Score: raw.miniscore?.batTeam?.teamScoreStr,
    team2Score: raw.miniscore?.inningsScoreList?.[0]?.scoreStr,
    currentOver: raw.miniscore?.oversStr,
    striker: raw.miniscore?.batsmanStriker,
    nonStriker: raw.miniscore?.batsmanNonStriker,
    bowler: raw.miniscore?.bowlerStriker
  };
}

async function fetchPlayerStats(playerId) {
  const res = await axios.get(`${CRICKET_API_BASE}/stats/v1/player/${playerId}`, { headers: HEADERS });
  return res.data;
}

module.exports = { fetchCricketData, fetchIPLMatches, fetchPlayerStats };


// ============================================================
// ANTI-CHEAT / SECURITY SERVICE
// ============================================================

// ─── services/antiCheat.js ───────────────────────────────────
async function detectSuspiciousActivity(userId) {
  const recentTxns = await Transaction.find({ userId, type: 'winning' })
    .sort('-createdAt').limit(20);

  const recentContests = await Team.find({ userId }).sort('-createdAt').limit(50);

  // Flag if win rate > 80% with 10+ contests
  const winRate = recentTxns.length / Math.max(recentContests.length, 1);
  if (recentContests.length >= 10 && winRate > 0.8) {
    await User.findByIdAndUpdate(userId, { isFlagged: true });
    console.log(`🚨 User ${userId} flagged for high win rate: ${(winRate*100).toFixed(1)}%`);
    return { flagged: true, reason: 'Abnormal win rate detected' };
  }

  // Flag multiple accounts from same IP
  const user = await User.findById(userId);
  if (user.ipHistory?.length > 0) {
    const sameIpUsers = await User.countDocuments({
      _id: { $ne: userId }, ipHistory: { $in: user.ipHistory }
    });
    if (sameIpUsers > 2) {
      await User.findByIdAndUpdate(userId, { isFlagged: true });
      return { flagged: true, reason: 'Multiple accounts from same IP' };
    }
  }

  return { flagged: false };
}

module.exports = { detectSuspiciousActivity };


// ============================================================
// ENVIRONMENT CONFIG (.env.example)
// ============================================================

/*
NODE_ENV=production
PORT=5000
MONGODB_URI=mongodb+srv://user:pass@cluster.mongodb.net/cricketx
JWT_SECRET=your-256-bit-secret-here
RAPIDAPI_KEY=your-rapidapi-key
TWILIO_SID=your-twilio-sid
TWILIO_TOKEN=your-twilio-auth-token
TWILIO_PHONE=+1234567890
RAZORPAY_KEY_ID=rzp_live_xxxxx
RAZORPAY_SECRET=your-razorpay-secret
ALLOWED_ORIGINS=https://cricketx.in,https://www.cricketx.in
REDIS_URL=redis://localhost:6379
*/


// ============================================================
// PACKAGE.JSON
// ============================================================

/*
{
  "name": "cricketx-backend",
  "version": "1.0.0",
  "scripts": {
    "start": "node server.js",
    "dev": "nodemon server.js",
    "test": "jest --coverage"
  },
  "dependencies": {
    "axios": "^1.6.0",
    "bcryptjs": "^2.4.3",
    "cors": "^2.8.5",
    "dotenv": "^16.3.1",
    "express": "^4.18.2",
    "express-rate-limit": "^7.1.5",
    "helmet": "^7.1.0",
    "jsonwebtoken": "^9.0.2",
    "mongoose": "^8.0.3",
    "morgan": "^1.10.0",
    "razorpay": "^2.9.2",
    "socket.io": "^4.6.1",
    "twilio": "^4.20.0"
  },
  "devDependencies": {
    "jest": "^29.7.0",
    "nodemon": "^3.0.2",
    "supertest": "^6.3.3"
  }
}
*/
