// The search page. It only talks to our own API (/api/...), never to IGDB.
// Everything that comes back from the API is put on the page with textContent,
// not innerHTML, so a game name can never inject HTML or scripts.

const LIST_LABELS = {
  backlog: 'Backlog',
  playing: 'Playing',
  completed: 'Completed',
  wishlist: 'Wishlist',
};

const form = document.getElementById('search-form');
const resultsEl = document.getElementById('results');
const statusEl = document.getElementById('status');
const pagerEl = document.getElementById('pager');
const prevBtn = document.getElementById('prev');
const nextBtn = document.getElementById('next');
const pageLabel = document.getElementById('page-label');

let currentView = 'search'; // 'search' or one of the list names
let page = 1;
let saved = {}; // game id -> list name, for every game the user has saved

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

// Make an element, optionally with a CSS class and some text.
function el(tag, className, text) {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text != null) e.textContent = text;
  return e;
}

function setStatus(message) {
  statusEl.textContent = message;
}

// After login, Cognito (see auth.js) keeps the login token in the browser's storage.
// We read it from there instead of loading the Cognito library on this page, because
// this page's security policy only allows scripts from our own site.
const COGNITO_CLIENT_ID = '1bf58elkgde695r5fhhjjq1n75';

function getIdToken() {
  const prefix = 'CognitoIdentityServiceProvider.' + COGNITO_CLIENT_ID + '.';
  for (const store of [window.localStorage, window.sessionStorage]) {
    try {
      const username = store.getItem(prefix + 'LastAuthUser');
      const token = username && store.getItem(prefix + username + '.idToken');
      if (token) return token;
    } catch (err) {
      // storage not available: treat as logged out
    }
  }
  return null;
}

// Call our API and return the JSON. Sends the login token if there is one.
// Throws if the server says something went wrong.
async function api(url, options) {
  const opts = { ...(options || {}) };
  const token = getIdToken();
  if (token) opts.headers = { ...(opts.headers || {}), Authorization: 'Bearer ' + token };
  const res = await fetch(url, opts);
  if (!res.ok) {
    const error = new Error('request failed (' + res.status + ')');
    error.status = res.status;
    throw error;
  }
  return res.json();
}

// ---------------------------------------------------------------------------
// Loading data
// ---------------------------------------------------------------------------

async function loadFilters() {
  try {
    const [genres, platforms] = await Promise.all([api('/api/genres'), api('/api/platforms')]);
    for (const g of genres) document.getElementById('genre').append(new Option(g.name, g.id));
    for (const p of platforms) document.getElementById('platform').append(new Option(p.name, p.id));
  } catch (err) {
    setStatus('Could not load the genre and platform filters.');
  }
}

// Get the user's saved games and remember which list each one is in.
async function loadSaved() {
  try {
    const items = await api('/api/lists');
    saved = {};
    for (const item of items) saved[item.igdbId] = item.list;
    return items;
  } catch (err) {
    saved = {};
    setStatus(
      err.status === 401
        ? 'Log in to save games to your lists.'
        : 'Your lists are not available right now.'
    );
    return [];
  }
}

// ---------------------------------------------------------------------------
// Drawing the page
// ---------------------------------------------------------------------------

function makeCard(game) {
  const card = el('div', 'card');

  if (game.coverUrl) {
    const img = el('img');
    img.src = game.coverUrl;
    img.alt = game.name + ' cover';
    img.loading = 'lazy';
    card.append(img);
  } else {
    card.append(el('div', 'no-cover', 'No cover'));
  }

  card.append(el('h3', null, game.name));

  const details = [
    game.year,
    game.rating ? game.rating + '/100' : null,
    (game.genres || []).slice(0, 2).join(', '),
  ]
    .filter(Boolean)
    .join(' · ');
  if (details) card.append(el('p', 'details', details));

  card.append(makeListPicker(game));
  return card;
}

// The drop-down on each card that puts the game in a list (or takes it out).
function makeListPicker(game) {
  const select = el('select', 'list-picker');
  select.setAttribute('aria-label', 'List for ' + game.name);
  select.append(new Option('Add to list...', ''));
  for (const key in LIST_LABELS) select.append(new Option(LIST_LABELS[key], key));
  select.value = saved[game.id] || '';

  select.addEventListener('change', async () => {
    const list = select.value;
    try {
      if (list === '') {
        await api('/api/lists/' + game.id, { method: 'DELETE' });
        delete saved[game.id];
      } else {
        await api('/api/lists/' + game.id, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ list: list, name: game.name, coverUrl: game.coverUrl }),
        });
        saved[game.id] = list;
      }
      // In a list view the game may no longer belong here, so redraw it.
      if (currentView !== 'search') await showView(currentView);
      setStatus(list === '' ? 'Removed from your lists.' : 'Saved to ' + LIST_LABELS[list] + '.');
    } catch (err) {
      select.value = saved[game.id] || '';
      setStatus(
        err.status === 401
          ? 'Log in to save games to your lists.'
          : 'Could not update your list: ' + err.message
      );
    }
  });

  return select;
}

function drawGames(games) {
  resultsEl.replaceChildren(...games.map(makeCard));
}

// ---------------------------------------------------------------------------
// Search and list views
// ---------------------------------------------------------------------------

async function runSearch() {
  const params = new URLSearchParams({
    q: document.getElementById('q').value,
    genre: document.getElementById('genre').value,
    platform: document.getElementById('platform').value,
    sort: document.getElementById('sort').value,
    page: page,
  });

  setStatus('Searching...');
  try {
    const data = await api('/api/games/search?' + params);
    drawGames(data.games);
    setStatus(data.games.length === 0 ? 'No games found. Try fewer filters.' : '');
    pageLabel.textContent = 'Page ' + data.page;
    prevBtn.disabled = data.page <= 1;
    nextBtn.disabled = !data.hasMore;
  } catch (err) {
    resultsEl.replaceChildren();
    setStatus('Search failed. Please try again in a moment.');
  }
}

// Show either the search view or one of the four lists.
async function showView(view) {
  currentView = view;

  for (const button of document.querySelectorAll('#views button')) {
    button.classList.toggle('active', button.dataset.view === view);
  }
  const isSearch = view === 'search';
  form.hidden = !isSearch;
  pagerEl.hidden = !isSearch;

  if (isSearch) {
    await runSearch();
    return;
  }

  const items = await loadSaved();
  const games = items
    .filter((item) => item.list === view)
    .map((item) => ({ id: item.igdbId, name: item.name, coverUrl: item.coverUrl }));
  drawGames(games);
  setStatus(
    games.length === 0
      ? 'Nothing in your ' + LIST_LABELS[view] + ' list yet. Add games from Search.'
      : games.length + (games.length === 1 ? ' game' : ' games') + ' in your ' + LIST_LABELS[view] + ' list.'
  );
}

// ---------------------------------------------------------------------------
// Wiring things up
// ---------------------------------------------------------------------------

form.addEventListener('submit', (event) => {
  event.preventDefault();
  page = 1;
  runSearch();
});

prevBtn.addEventListener('click', () => {
  page = Math.max(1, page - 1);
  runSearch();
  window.scrollTo(0, 0);
});

nextBtn.addEventListener('click', () => {
  page += 1;
  runSearch();
  window.scrollTo(0, 0);
});

document.getElementById('views').addEventListener('click', (event) => {
  const view = event.target.dataset.view;
  if (view) showView(view);
});

async function start() {
  // The search box in the site header sends people here as search.html?q=zelda
  document.getElementById('q').value = new URLSearchParams(location.search).get('q') || '';
  await Promise.all([loadFilters(), loadSaved()]);
  await showView('search');
}
start();
