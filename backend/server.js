// CoolGames API
//   1. Searches IGDB for games (GET /api/games/search, /api/genres, /api/platforms)
//   2. Stores each user's personal lists: backlog, playing, completed, wishlist (/api/lists)
//
// Why a backend at all? IGDB does not allow calls straight from a browser, and the
// Twitch client secret must never be sent to a browser. So the browser calls us,
// and we call IGDB.

require('dotenv').config();
const path = require('path');
const express = require('express');
const mysql = require('mysql2/promise');

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;
const CLIENT_ID = process.env.TWITCH_CLIENT_ID;
const CLIENT_SECRET = process.env.TWITCH_CLIENT_SECRET;

// MOCK=1 serves fake sample games so you can run everything without IGDB keys.
const MOCK = process.env.MOCK === '1';
if (!MOCK && (!CLIENT_ID || !CLIENT_SECRET)) {
  console.error('Set TWITCH_CLIENT_ID and TWITCH_CLIENT_SECRET in .env (or run with MOCK=1).');
  process.exit(1);
}

const LISTS = ['backlog', 'playing', 'completed', 'wishlist'];

// What the user can sort by, and the IGDB field and direction that goes with it.
const SORTS = {
  rating: { field: 'total_rating', dir: 'desc' },
  newest: { field: 'first_release_date', dir: 'desc' },
  name: { field: 'name', dir: 'asc' },
};

const PAGE_SIZE = 20;

// ---------------------------------------------------------------------------
// Small helpers that clean user input before it goes anywhere near a query
// ---------------------------------------------------------------------------

// Remove the characters that have a meaning in IGDB's query language.
function cleanText(text) {
  return String(text || '').replace(/["\\;*~]/g, ' ').trim().slice(0, 60);
}

// Only accept a positive whole number. Anything else becomes null.
function toId(value) {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 && n < 2147483647 ? n : null;
}

// Wraps an async route so a thrown error becomes a clean 500 response.
const wrap = (fn) => (req, res) =>
  fn(req, res).catch((err) => {
    console.error(err);
    res.status(500).json({ error: 'Something went wrong' });
  });

// ---------------------------------------------------------------------------
// Talking to IGDB
// ---------------------------------------------------------------------------

// Twitch gives us a token that lasts weeks. We keep it and only ask for a new
// one when it is about to expire.
let token = null;
let tokenExpiresAt = 0;

async function getToken() {
  if (token && Date.now() < tokenExpiresAt) return token;
  const url =
    'https://id.twitch.tv/oauth2/token?client_id=' + encodeURIComponent(CLIENT_ID) +
    '&client_secret=' + encodeURIComponent(CLIENT_SECRET) +
    '&grant_type=client_credentials';
  const res = await fetch(url, { method: 'POST' });
  if (!res.ok) throw new Error('Twitch token request failed: ' + res.status);
  const data = await res.json();
  token = data.access_token;
  tokenExpiresAt = Date.now() + (data.expires_in - 60) * 1000;
  return token;
}

// IGDB allows about 4 requests per second, so we remember answers for a few
// minutes. Repeated searches then cost nothing.
const cache = new Map();

async function igdb(endpoint, query, ttlSeconds = 300) {
  const key = endpoint + '|' + query;
  const hit = cache.get(key);
  if (hit && Date.now() < hit.expires) return hit.data;

  const res = await fetch('https://api.igdb.com/v4/' + endpoint, {
    method: 'POST',
    headers: {
      'Client-ID': CLIENT_ID,
      Authorization: 'Bearer ' + (await getToken()),
      Accept: 'application/json',
    },
    body: query,
  });
  if (!res.ok) throw new Error('IGDB returned ' + res.status);
  const data = await res.json();

  if (cache.size > 500) cache.clear();
  cache.set(key, { data, expires: Date.now() + ttlSeconds * 1000 });
  return data;
}

// Turn IGDB's shape into the small shape the web page needs.
function formatGame(g) {
  return {
    id: g.id,
    name: g.name,
    coverUrl: g.cover
      ? 'https://images.igdb.com/igdb/image/upload/t_cover_big/' + g.cover.image_id + '.jpg'
      : null,
    year: g.first_release_date ? new Date(g.first_release_date * 1000).getUTCFullYear() : null,
    rating: g.total_rating ? Math.round(g.total_rating) : null,
    genres: (g.genres || []).map((x) => x.name),
    platforms: (g.platforms || []).map((x) => x.name),
  };
}

// ---------------------------------------------------------------------------
// Fake data for MOCK=1
// ---------------------------------------------------------------------------

const MOCK_GENRES = [
  { id: 8, name: 'Platform' },
  { id: 9, name: 'Puzzle' },
  { id: 12, name: 'Role-playing (RPG)' },
];
const MOCK_PLATFORMS = [
  { id: 6, name: 'PC (Microsoft Windows)' },
  { id: 130, name: 'Nintendo Switch' },
];
const MOCK_GAMES = [
  { id: 1001, name: 'Sample: Pixel Quest', year: 2019, rating: 88, genreIds: [8], platformIds: [6, 130] },
  { id: 1002, name: 'Sample: Puzzle Garden', year: 2021, rating: 74, genreIds: [9], platformIds: [6] },
  { id: 1003, name: 'Sample: Dragon Ledger', year: 2016, rating: 91, genreIds: [12], platformIds: [6] },
  { id: 1004, name: 'Sample: Cloud Hopper', year: 2023, rating: 67, genreIds: [8], platformIds: [130] },
  { id: 1005, name: 'Sample: Tile Tactics', year: 2012, rating: 80, genreIds: [9, 12], platformIds: [6, 130] },
].map((g) => ({
  id: g.id,
  name: g.name,
  coverUrl: null,
  year: g.year,
  rating: g.rating,
  genreIds: g.genreIds,
  platformIds: g.platformIds,
  genres: g.genreIds.map((id) => MOCK_GENRES.find((x) => x.id === id).name),
  platforms: g.platformIds.map((id) => MOCK_PLATFORMS.find((x) => x.id === id).name),
}));

function mockSearch({ q, genre, platform, sort, page }) {
  let games = MOCK_GAMES.filter(
    (g) =>
      g.name.toLowerCase().includes(q.toLowerCase()) &&
      (!genre || g.genreIds.includes(genre)) &&
      (!platform || g.platformIds.includes(platform))
  );
  const field = { rating: 'rating', newest: 'year', name: 'name' }[sort];
  games.sort((a, b) => (field === 'name' ? a.name.localeCompare(b.name) : b[field] - a[field]));
  const start = (page - 1) * PAGE_SIZE;
  return {
    page,
    hasMore: games.length > start + PAGE_SIZE,
    games: games.slice(start, start + PAGE_SIZE),
  };
}

// ---------------------------------------------------------------------------
// Search routes
// ---------------------------------------------------------------------------

app.get(
  '/api/games/search',
  wrap(async (req, res) => {
    const q = cleanText(req.query.q);
    const genre = toId(req.query.genre);
    const platform = toId(req.query.platform);
    const sort = SORTS[req.query.sort] ? req.query.sort : 'rating';
    const page = toId(req.query.page) || 1;

    if (MOCK) return res.json(mockSearch({ q, genre, platform, sort, page }));

    // Build the "where" part of the IGDB query one condition at a time.
    // Everything that goes in is either a number or text we cleaned above.
    const where = ['cover != null'];
    if (q) where.push('name ~ *"' + q + '"*'); // name contains q, ignoring case
    if (genre) where.push('genres = [' + genre + ']');
    if (platform) where.push('platforms = [' + platform + ']');
    if (sort === 'rating') where.push('total_rating != null');
    if (sort === 'newest') where.push('first_release_date != null');

    const { field, dir } = SORTS[sort];
    const query =
      'fields name, cover.image_id, first_release_date, total_rating, genres.name, platforms.name;\n' +
      'where ' + where.join(' & ') + ';\n' +
      'sort ' + field + ' ' + dir + ';\n' +
      // Ask for one extra game so we know whether a next page exists.
      'limit ' + (PAGE_SIZE + 1) + ';\n' +
      'offset ' + (page - 1) * PAGE_SIZE + ';';

    const results = await igdb('games', query);
    res.json({
      page,
      hasMore: results.length > PAGE_SIZE,
      games: results.slice(0, PAGE_SIZE).map(formatGame),
    });
  })
);

// Options for the genre and platform drop-downs. Names come from IGDB itself.
app.get(
  '/api/genres',
  wrap(async (req, res) => {
    if (MOCK) return res.json(MOCK_GENRES);
    res.json(await igdb('genres', 'fields name; sort name asc; limit 50;', 3600));
  })
);

app.get(
  '/api/platforms',
  wrap(async (req, res) => {
    if (MOCK) return res.json(MOCK_PLATFORMS);
    // A short list of common platforms instead of every one IGDB knows.
    res.json(
      await igdb('platforms', 'fields name; where id = (6, 3, 14, 48, 167, 49, 169, 130); sort name asc; limit 20;', 3600)
    );
  })
);

// ---------------------------------------------------------------------------
// Personal lists
// ---------------------------------------------------------------------------
// A game can be in one list per user, so saving it again just moves it.

// Used when no database is configured (local testing). Lost on restart.
function memoryStore() {
  const rows = new Map();
  return {
    async getAll(userId) {
      return [...rows.values()]
        .filter((r) => r.userId === userId)
        .sort((a, b) => b.addedAt - a.addedAt);
    },
    async set(userId, game, list) {
      const key = userId + ':' + game.igdbId;
      const old = rows.get(key);
      rows.set(key, { userId, ...game, list, addedAt: old ? old.addedAt : Date.now() });
    },
    async remove(userId, igdbId) {
      rows.delete(userId + ':' + igdbId);
    },
  };
}

// Used when DB_HOST is set. Every query uses ? placeholders, so user input is
// never pasted into the SQL text (this is what stops SQL injection).
function mysqlStore(pool) {
  return {
    async getAll(userId) {
      const [rows] = await pool.query(
        'SELECT igdb_id, game_name, cover_url, list_name, added_at FROM user_games WHERE user_id = ? ORDER BY added_at DESC',
        [userId]
      );
      return rows.map((r) => ({
        igdbId: r.igdb_id,
        name: r.game_name,
        coverUrl: r.cover_url,
        list: r.list_name,
        addedAt: r.added_at,
      }));
    },
    async set(userId, game, list) {
      await pool.query(
        'INSERT INTO user_games (user_id, igdb_id, game_name, cover_url, list_name) VALUES (?, ?, ?, ?, ?) ' +
          'ON DUPLICATE KEY UPDATE list_name = ?',
        [userId, game.igdbId, game.name, game.coverUrl, list, list]
      );
    },
    async remove(userId, igdbId) {
      await pool.query('DELETE FROM user_games WHERE user_id = ? AND igdb_id = ?', [userId, igdbId]);
    },
  };
}

const store = process.env.DB_HOST
  ? mysqlStore(
      mysql.createPool({
        host: process.env.DB_HOST,
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        database: process.env.DB_NAME,
        connectionLimit: 5,
      })
    )
  : memoryStore();

// TODO (Milestone 2): there is no login yet, so everyone is user 1.
// When login exists, return the id of the signed-in user here and nowhere else.
function getUserId(req) {
  return 1;
}

app.get(
  '/api/lists',
  wrap(async (req, res) => {
    res.json(await store.getAll(getUserId(req)));
  })
);

app.put(
  '/api/lists/:igdbId',
  wrap(async (req, res) => {
    const igdbId = toId(req.params.igdbId);
    const { list, name, coverUrl } = req.body || {};
    const cleanName = String(name || '').trim().slice(0, 255);

    if (!igdbId || !LISTS.includes(list) || !cleanName) {
      return res.status(400).json({ error: 'Need a game id, a name, and one of: ' + LISTS.join(', ') });
    }
    // Only accept cover links that point at IGDB's image server.
    const cleanCover =
      typeof coverUrl === 'string' && coverUrl.startsWith('https://images.igdb.com/')
        ? coverUrl.slice(0, 500)
        : null;

    await store.set(getUserId(req), { igdbId, name: cleanName, coverUrl: cleanCover }, list);
    res.json({ ok: true });
  })
);

app.delete(
  '/api/lists/:igdbId',
  wrap(async (req, res) => {
    const igdbId = toId(req.params.igdbId);
    if (!igdbId) return res.status(400).json({ error: 'Invalid game id' });
    await store.remove(getUserId(req), igdbId);
    res.json({ ok: true });
  })
);

// ---------------------------------------------------------------------------
// For local testing only: serve the web page from here too.
// On AWS, Apache serves the page and forwards /api to this server instead.
// ---------------------------------------------------------------------------
app.use(express.static(path.join(__dirname, '..', 'frontend')));

app.listen(PORT, () => {
  console.log('CoolGames API on port ' + PORT + (MOCK ? ' (MOCK mode)' : '') +
    (process.env.DB_HOST ? ' with MySQL' : ' with in-memory lists'));
});
