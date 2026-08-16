const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
require('dotenv').config();

const usersRoutes = require('./routes/users');
const gameRequestsRoutes = require('./routes/gameRequests');
const gamesRoutes = require('./routes/games');
const walletRoutes = require('./routes/wallet');

const app = express();

app.use(helmet());
app.use(cors());
app.use(express.json());
app.use(morgan('dev'));

app.get('/', (req, res) => res.json({ ok: true, service: 'whot-backend' }));
app.get('/health', (req, res) => res.json({ ok: true, service: 'whot-backend' }));

app.use('/api/users', usersRoutes);
app.use('/api/requests', gameRequestsRoutes);
app.use('/api/games', gamesRoutes);
app.use('/api/wallet', walletRoutes);

// Central error handler
app.use((err, req, res, next) => {
  console.error(err);
  res.status(err.status || 500).json({ error: err.message || 'Internal server error' });
});

const PORT = process.env.PORT || 4000;
const HOST = '0.0.0.0';
app.listen(PORT, HOST, () => console.log(`Whot backend running on ${HOST}:${PORT}`));
