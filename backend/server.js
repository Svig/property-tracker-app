require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');

const authRoutes = require('./routes/auth.routes');
const userRoutes = require('./routes/users.routes');
const clientRoutes = require('./routes/clients.routes');
const viewingRoutes = require('./routes/viewing.routes');
const propertiesRoutes = require('./routes/properties.routes');

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

app.listen(PORT, () => {
  console.log(`Viewing Register running at http://localhost:${PORT}`);
});
