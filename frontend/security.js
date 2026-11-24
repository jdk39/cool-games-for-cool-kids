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

// Demo for the home page: shows what the user searched, safely.
const searchForm = document.querySelector('.search-form');
const mainCol = document.querySelector('.main-col');

if (searchForm && mainCol) {
  const input = searchForm.querySelector('input');
  const message = document.createElement('p');
  message.className = 'search-message';
  mainCol.prepend(message);

  searchForm.addEventListener('submit', (event) => {
    event.preventDefault();
    // textContent shows the text literally — HTML and scripts never run
    message.textContent = `You searched for: ${input.value}`;
  });
}