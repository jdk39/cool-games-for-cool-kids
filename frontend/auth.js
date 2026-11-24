// auth.js — Cognito sign-up, email verification, and login
// Load the Cognito library before this file (see login.html / register.html).

// Cognito IDs (not secrets; safe in frontend code)
const COGNITO_CONFIG = {
  UserPoolId: "us-east-2_kqJtlu8T0",
  ClientId: "1bf58elkgde695r5fhhjjq1n75"
};

// Connect to the user pool. "remember" keeps the session after the browser closes.
function getPool(remember = true) {
  return new AmazonCognitoIdentity.CognitoUserPool({
    ...COGNITO_CONFIG,
    Storage: remember ? window.localStorage : window.sessionStorage
  });
}

// Show an error (red) or success (green) message. textContent prevents XSS.
function showMessage(el, text, isError = true) {
  el.textContent = text;
  el.style.display = "block";
  el.style.color = isError ? "#ff6b6b" : "#4ade80";
}

// --- Input validation rules ---
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const USERNAME_RE = /^[A-Za-z0-9_]{3,20}$/; // letters, numbers, underscores only

// Matches Cognito's default password policy; returns an error message or null
function passwordProblem(pw) {
  if (pw.length < 8) return "Password must be at least 8 characters.";
  if (!/[A-Z]/.test(pw)) return "Password needs an uppercase letter.";
  if (!/[a-z]/.test(pw)) return "Password needs a lowercase letter.";
  if (!/[0-9]/.test(pw)) return "Password needs a number.";
  if (!/[^A-Za-z0-9]/.test(pw)) return "Password needs a symbol.";
  return null;
}

// Create an account; Cognito then emails a 6-digit code
function cognitoSignUp(username, email, password) {
  const attributes = [
    new AmazonCognitoIdentity.CognitoUserAttribute({ Name: "email", Value: email }),
    new AmazonCognitoIdentity.CognitoUserAttribute({ Name: "preferred_username", Value: username })
  ];
  return new Promise((resolve, reject) => {
    getPool().signUp(email, password, attributes, null, (err, result) =>
      err ? reject(err) : resolve(result)
    );
  });
}

// Confirm the account with the emailed code
function cognitoConfirm(email, code) {
  const user = new AmazonCognitoIdentity.CognitoUser({ Username: email, Pool: getPool() });
  return new Promise((resolve, reject) => {
    user.confirmRegistration(code, true, (err, result) => (err ? reject(err) : resolve(result)));
  });
}

// Email a new code
function cognitoResendCode(email) {
  const user = new AmazonCognitoIdentity.CognitoUser({ Username: email, Pool: getPool() });
  return new Promise((resolve, reject) => {
    user.resendConfirmationCode((err, result) => (err ? reject(err) : resolve(result)));
  });
}

// Log in; the password goes to Cognito over HTTPS and Cognito returns login tokens
function cognitoSignIn(email, password, remember) {
  const pool = getPool(remember);
  const user = new AmazonCognitoIdentity.CognitoUser({
    Username: email,
    Pool: pool,
    Storage: remember ? window.localStorage : window.sessionStorage
  });
  const details = new AmazonCognitoIdentity.AuthenticationDetails({ Username: email, Password: password });
  user.setAuthenticationFlowType("USER_PASSWORD_AUTH"); // needs ALLOW_USER_PASSWORD_AUTH on the app client
  return new Promise((resolve, reject) => {
    user.authenticateUser(details, {
      onSuccess: (session) => resolve(session),
      onFailure: (err) => reject(err)
    });
  });
}

// Returns the logged-in user (or null). Use on any page that needs login.
function getCurrentUser() {
  const user = getPool(true).getCurrentUser() || getPool(false).getCurrentUser();
  if (!user) return Promise.resolve(null);
  return new Promise((resolve) => {
    user.getSession((err, session) => {
      if (err || !session.isValid()) return resolve(null);
      const p = session.getIdToken().payload;
      resolve({
        email: p.email,
        username: p.preferred_username || p.email,
        idToken: session.getIdToken().getJwtToken() // send to backend as "Authorization: Bearer <token>"
      });
    });
  });
}

// Log out and go back to the login page
function cognitoSignOut() {
  const user = getPool(true).getCurrentUser() || getPool(false).getCurrentUser();
  if (user) user.signOut();
  window.location.href = "login.html";
}
