// auth.js — Cognito sign-up / sign-in for Cool Games for Cool Kids
// Needs: <script src="https://unpkg.com/amazon-cognito-identity-js@6.3.12/dist/amazon-cognito-identity.min.js"></script>
// loaded BEFORE this file.

// ---- 1. Fill these in from the Cognito console (not secrets — safe in frontend code) ----
const COGNITO_CONFIG = {
  UserPoolId: "us-east-2_kqJtlu8T0",        // Cognito > User pools > your pool > "User pool ID"
  ClientId: "1bf58elkgde695r5fhhjjq1n75"    // Cognito > your pool > App clients > "Client ID"
};

// ---- helpers ----
function getPool(remember = true) {
  // "Remember me" keeps the session in localStorage; otherwise it ends when the tab closes.
  return new AmazonCognitoIdentity.CognitoUserPool({
    ...COGNITO_CONFIG,
    Storage: remember ? window.localStorage : window.sessionStorage
  });
}

function showMessage(el, text, isError = true) {
  el.textContent = text;
  el.style.display = "block";
  el.style.color = isError ? "#ff6b6b" : "#4ade80";
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const USERNAME_RE = /^[A-Za-z0-9_]{3,20}$/;

// Matches Cognito's default password policy: 8+ chars, upper, lower, number, symbol
function passwordProblem(pw) {
  if (pw.length < 8) return "Password must be at least 8 characters.";
  if (!/[A-Z]/.test(pw)) return "Password needs an uppercase letter.";
  if (!/[a-z]/.test(pw)) return "Password needs a lowercase letter.";
  if (!/[0-9]/.test(pw)) return "Password needs a number.";
  if (!/[^A-Za-z0-9]/.test(pw)) return "Password needs a symbol.";
  return null;
}

// ---- 2. Register ----
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

// ---- 3. Confirm account with the code Cognito emails ----
function cognitoConfirm(email, code) {
  const user = new AmazonCognitoIdentity.CognitoUser({ Username: email, Pool: getPool() });
  return new Promise((resolve, reject) => {
    user.confirmRegistration(code, true, (err, result) => (err ? reject(err) : resolve(result)));
  });
}

function cognitoResendCode(email) {
  const user = new AmazonCognitoIdentity.CognitoUser({ Username: email, Pool: getPool() });
  return new Promise((resolve, reject) => {
    user.resendConfirmationCode((err, result) => (err ? reject(err) : resolve(result)));
  });
}

// ---- 4. Log in ----
function cognitoSignIn(email, password, remember) {
  const pool = getPool(remember);
  const user = new AmazonCognitoIdentity.CognitoUser({
    Username: email,
    Pool: pool,
    Storage: remember ? window.localStorage : window.sessionStorage
  });
  const details = new AmazonCognitoIdentity.AuthenticationDetails({ Username: email, Password: password });
  return new Promise((resolve, reject) => {
    user.authenticateUser(details, {
      onSuccess: (session) => resolve(session),
      onFailure: (err) => reject(err)
    });
  });
}

// ---- 5. Use on any page: who's logged in? ----
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

function cognitoSignOut() {
  const user = getPool(true).getCurrentUser() || getPool(false).getCurrentUser();
  if (user) user.signOut();
  window.location.href = "login.html";
}
