// Top-right corner of every page: shows who is logged in and lets them sign out.
//
// Login itself is handled by Cognito (see auth.js). After login, Cognito keeps the
// login token in the browser's storage, and the user's name is inside that token.
// We read it from there. This file does not need the Cognito library, so it also
// works on pages whose security policy only allows scripts from our own site.

(function () {
  const PREFIX = 'CognitoIdentityServiceProvider.1bf58elkgde695r5fhhjjq1n75';
  const stores = [];
  try { stores.push(window.localStorage); } catch (err) { /* storage not available */ }
  try { stores.push(window.sessionStorage); } catch (err) { /* storage not available */ }

  // Find the saved login token, or null if nobody is logged in.
  function findToken() {
    for (const store of stores) {
      const username = store.getItem(PREFIX + '.LastAuthUser');
      const token = username && store.getItem(PREFIX + '.' + username + '.idToken');
      if (token) return token;
    }
    return null;
  }

  // A login token is three parts joined by dots. The middle part is the user's
  // details written as JSON. We only read it to show a name, nothing more.
  function readName(token) {
    try {
      const middle = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
      const bytes = Uint8Array.from(atob(middle), (c) => c.charCodeAt(0));
      const details = JSON.parse(new TextDecoder().decode(bytes));
      return details.preferred_username || details.email || null;
    } catch (err) {
      return null;
    }
  }

  // Forget the login on this browser, then go to the login page.
  function signOut() {
    for (const store of stores) {
      const keys = [];
      for (let i = 0; i < store.length; i++) keys.push(store.key(i));
      for (const key of keys) {
        if (key.startsWith(PREFIX + '.')) store.removeItem(key);
      }
    }
    window.location.href = 'login.html';
  }

  function showUser() {
    const chip = document.querySelector('.user-chip');
    if (!chip) return;

    const token = findToken();
    const name = token && readName(token);

    if (!name) {
      const link = document.createElement('a');
      link.href = 'login.html';
      link.className = 'link-btn';
      link.textContent = 'Log in';
      chip.replaceChildren(link);
      return;
    }

    const avatar = document.createElement('div');
    avatar.className = 'avatar';
    avatar.textContent = name.charAt(0).toUpperCase();

    const hello = document.createElement('span');
    hello.textContent = 'Hi, ' + name;

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'link-btn';
    button.textContent = 'Sign out';
    button.addEventListener('click', signOut);

    chip.replaceChildren(avatar, hello, button);
  }

  showUser();
})();
