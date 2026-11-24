// security.js – XSS protection helpers

// Turns dangerous characters into harmless text.
// Use this whenever you must put user or IGDB data into innerHTML.
function escapeHTML(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Home page search box: send the search to the Browse page (search.html?q=...).
// encodeURIComponent keeps characters like & # < > from breaking the address.
const searchForm = document.querySelector('.search-form');

if (searchForm) {
  const input = searchForm.querySelector('input');

  searchForm.addEventListener('submit', (event) => {
    event.preventDefault();
    const q = input.value.trim();
    if (q.length < 2) return;
    window.location.href = 'search.html?q=' + encodeURIComponent(q);
  });
}