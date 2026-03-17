require('dotenv').config();
const express    = require('express');
const cors       = require('cors');
const helmet     = require('helmet');
const morgan     = require('morgan');
const path       = require('path');
const fs         = require('fs');

const app  = express();
const PORT = process.env.PORT || 3000;

// ── Uploads directory ──────────────────────────────────────────────────────────
const uploadDir = path.join(__dirname, '..', process.env.UPLOAD_DIR || 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

// ── Global middleware ──────────────────────────────────────────────────────────
app.use(helmet());
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use('/uploads', express.static(uploadDir));

// ── Health ─────────────────────────────────────────────────────────────────────
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString(), version: '1.0.0' });
});

// ── API Root ───────────────────────────────────────────────────────────────────
app.get('/api/v1', (_req, res) => {
  res.json({
    message: '🏍️  BikerApp API v1.0',
    docs: 'See README.md for full endpoint reference',
    endpoints: {
      auth:        '/api/v1/auth',
      rides:       '/api/v1/rides',
      groups:      '/api/v1/groups',
      expenses:    '/api/v1/expenses',
      vehicles:    '/api/v1/vehicles',
      accessories: '/api/v1/accessories',
      marketplace: '/api/v1/marketplace',
      sos:         '/api/v1/sos',
    },
  });
});

// ── Routes ─────────────────────────────────────────────────────────────────────
app.use('/api/v1/auth',        require('./routes/auth'));
app.use('/api/v1/rides',       require('./routes/rides'));
app.use('/api/v1/groups',      require('./routes/groups'));
app.use('/api/v1/expenses',    require('./routes/expenses'));
app.use('/api/v1/vehicles',    require('./routes/vehicles'));
app.use('/api/v1/accessories', require('./routes/accessories'));
app.use('/api/v1/marketplace', require('./routes/marketplace'));
app.use('/api/v1/sos',         require('./routes/sos'));

// ── 404 ────────────────────────────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({ success: false, message: `Route ${req.method} ${req.path} not found` });
});

// ── Error handler ──────────────────────────────────────────────────────────────
app.use(require('./middleware/errorHandler'));

// ── Start ──────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n🏍️  BikerApp API  →  http://localhost:${PORT}`);
  console.log(`📌  Base URL      →  http://localhost:${PORT}/api/v1`);
  console.log(`💊  Health check  →  http://localhost:${PORT}/health`);
  console.log(`🌱  Environment   →  ${process.env.NODE_ENV || 'development'}\n`);
});

module.exports = app;
