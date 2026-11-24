// CoolGames API
//   1. Searches IGDB for games (GET /api/games/search, /api/genres, /api/platforms)
//   2. Stores each user's personal lists: backlog, playing, completed, wishlist (/api/lists)
//
// Why a backend at all? IGDB does not allow calls straight from a browser, and the
// Twitch client secret must never be sent to a browser. So the browser calls us,
// and we call IGDB.

const express = require('express');
const mysql = require('mysql2/promise');

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;
const CLIENT_ID = process.env.TWITCH_CLIENT_ID;
const CLIENT_SECRET = process.env.TWITCH_CLIENT_SECRET;

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error('TWITCH_CLIENT_ID and TWITCH_CLIENT_SECRET are not set.');
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
    res.json(await igdb('genres', 'fields name; sort name asc; limit 50;', 3600));
  })
);

app.get(
  '/api/platforms',
  wrap(async (req, res) => {
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

// Every query uses ? placeholders, so user input is
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

const store = mysqlStore(
  mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    connectionLimit: 5,
  })
);

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

app.listen(PORT, () => {
  console.log('CoolGames API on port ' + PORT);
});
