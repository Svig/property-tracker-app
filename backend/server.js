require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');

const authRoutes = require('./routes/auth.routes');
const userRoutes = require('./routes/users.routes');
const clientRoutes = require('./routes/clients.routes');
const viewingRoutes = require('./routes/viewing.routes');
const propertiesRoutes = require('./routes/properties.routes');
const { bootstrapDatabase } = require('./scripts/bootstrap-db');

const app = express();
const PORT = process.env.PORT || 4000;

app.use(cors());
app.use(express.json());

app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/clients', clientRoutes);
app.use('/api/viewing', viewingRoutes);
app.use('/api/properties', propertiesRoutes);

app.get('/api/health', (req, res) => res.json({ ok: true }));

// Serve the frontend
app.use(express.static(path.join(__dirname, '..', 'public')));
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

// Basic error handler so a thrown error returns JSON instead of crashing silently
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Something went wrong on the server.' });
});

async function start() {
  try {
    await bootstrapDatabase();
  } catch (err) {
    // Fail loudly and stop here rather than serving an app that "looks up"
    // but can never actually log anyone in. Render's deploy logs will show
    // exactly what went wrong (auth failure, timeout, permissions, etc.)
    // instead of a silent, confusing "can't login" from the browser side.
    console.error('[bootstrap] FAILED — the server will not start. Fix the database connection (check DB_HOST/DB_PORT/DB_USER/DB_PASSWORD/DB_SSL) and redeploy.');
    process.exit(1);
  }

  app.listen(PORT, () => {
    console.log(`Viewing Register running at http://localhost:${PORT}`);
  });
}

start();
