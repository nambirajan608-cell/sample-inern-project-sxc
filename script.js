/**
 * ═══════════════════════════════════════════════════════════════
 *  KEYGUARD — Biometric Authentication System
 *  script.js  |  Core Engine
 *
 *  HOW KEYSTROKE BIOMETRICS WORKS:
 *  ─────────────────────────────────
 *  Keystroke dynamics (typing biometrics) captures the unique
 *  rhythm of how a person types. Two main metrics are measured:
 *
 *  1. DWELL TIME  — How long each key is held down (keydown → keyup)
 *  2. FLIGHT TIME — Time between releasing one key and pressing next
 *                   (keyup[n] → keydown[n+1])
 *
 *  Together these form a "typing signature" as unique as a fingerprint.
 *  During registration we collect 3 samples and average them.
 *  During login we compare the live typing to the stored profile
 *  using a similarity score based on standard deviation analysis.
 *
 *  LIMITATIONS OF FRONTEND-ONLY SECURITY:
 *  ───────────────────────────────────────
 *  - LocalStorage is readable by any JS on the page (XSS risk)
 *  - Biometric data should be stored server-side in production
 *  - This demo does NOT replace real authentication
 *  - A determined attacker can bypass client-side checks via DevTools
 *  - EmailJS keys are exposed in frontend — use a backend proxy in prod
 * ═══════════════════════════════════════════════════════════════
 */

'use strict';

/* ══════════════════════════════════════
   CONSTANTS & CONFIGURATION
══════════════════════════════════════ */

const CONFIG = {
  maxLoginAttempts: 5,       // lockout after this many failed logins
  lockoutDuration: 60,       // seconds to lock out after max attempts
  biometricThreshold: 55,    // minimum % score to pass biometric check
  pasteDetectionThreshold: 200, // ms — typing faster than this is suspicious

  // Weights for the overall biometric score (must sum to 100)
  weights: {
    wpm:    25,   // typing speed
    dwell:  35,   // key hold time
    flight: 40,   // key-to-key transition time
  }
};

const API_BASE = 'http://localhost:5000/api';

/* ══════════════════════════════════════
   STATE
══════════════════════════════════════ */

const state = {
  currentPage:     'login',
  currentUser:     null,
  currentUserData: null,
  loginAttempts:   0,
  lockoutUntil:    0,
  keystrokeChart:  null,

  // Login-time keystroke capture
  login: {
    keydownTimes: {},  // key → timestamp of keydown
    dwellTimes:   [],  // ms each key held
    flightTimes:  [],  // ms between keys
    lastKeyup:    null,
    startTime:    null,
    charCount:    0,
  },

  // Registration biometric samples
  reg: {
    samples:      [],  // array of captured biometric profiles
    currentSample: 1,
    keydownTimes: {},
    dwellTimes:   [],
    flightTimes:  [],
    lastKeyup:    null,
    startTime:    null,
  },

  // EmailJS configuration
  email: {
    serviceId:  localStorage.getItem('kg_email_service')   || '',
    templateId: localStorage.getItem('kg_email_template')  || '',
    publicKey:  localStorage.getItem('kg_email_pubkey')    || '',
  },
};

/* ══════════════════════════════════════
   DOM HELPERS
══════════════════════════════════════ */

/** Shorthand querySelector */
const $ = (sel, ctx = document) => ctx.querySelector(sel);
const $$ = (sel, ctx = document) => [...ctx.querySelectorAll(sel)];

/** Show a page by ID */
function showPage(name) {
  $$('.page').forEach(p => p.classList.remove('active'));
  $(`#page-${name}`).classList.add('active');
  state.currentPage = name;
  if (name === 'dashboard') loadDashboard();
  if (name === 'admin-panel') loadAdminUsers();
}

/** Show/hide loading state on a button */
function setLoading(btnId, loading) {
  const btn = $(btnId);
  if (!btn) return;
  btn.disabled = loading;
  btn.querySelector('.btn-text')?.classList.toggle('hidden', loading);
  btn.querySelector('.btn-loader')?.classList.toggle('hidden', !loading);
}

/* ══════════════════════════════════════
   TOAST NOTIFICATIONS
══════════════════════════════════════ */

/**
 * Display a non-blocking toast notification.
 * @param {string} title  - Bold heading
 * @param {string} msg    - Body text
 * @param {'success'|'error'|'warning'|'info'} type
 * @param {number}  duration - Auto-close ms (0 = manual)
 */
function toast(title, msg = '', type = 'info', duration = 4000) {
  const icons = { success: '✓', error: '⚠', warning: '⚡', info: '◈' };
  const t = document.createElement('div');
  t.className = `toast ${type}`;
  t.innerHTML = `
    <span class="toast-icon">${icons[type]}</span>
    <div class="toast-body">
      <div class="toast-title">${title}</div>
      ${msg ? `<div class="toast-msg">${msg}</div>` : ''}
    </div>`;
  t.addEventListener('click', () => removeToast(t));
  $('#toastContainer').appendChild(t);

  if (duration > 0) setTimeout(() => removeToast(t), duration);
}

function removeToast(t) {
  t.style.animation = 'toastOut 0.25s ease forwards';
  t.addEventListener('animationend', () => t.remove(), { once: true });
}

/* ══════════════════════════════════════
   MATRIX RAIN CANVAS
══════════════════════════════════════ */

/**
 * Renders an animated Matrix-style falling characters canvas.
 * Purely decorative — runs on a requestAnimationFrame loop.
 */
function initMatrix() {
  const canvas = document.getElementById('matrixCanvas');
  const ctx = canvas.getContext('2d');

  function resize() {
    canvas.width  = window.innerWidth;
    canvas.height = window.innerHeight;
  }
  resize();
  window.addEventListener('resize', resize);

  const chars   = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789@#$%^&*⬡◈⊕';
  const fontSize = 13;
  let columns   = Math.floor(window.innerWidth / fontSize);
  let drops     = Array.from({ length: columns }, () => Math.random() * -100);

  const neonColor = getComputedStyle(document.documentElement)
    .getPropertyValue('--c-neon').trim() || '#00e6b4';

  function draw() {
    ctx.fillStyle = 'rgba(5,10,15,0.05)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = neonColor;
    ctx.font = `${fontSize}px 'Share Tech Mono', monospace`;

    for (let i = 0; i < drops.length; i++) {
      const char = chars[Math.floor(Math.random() * chars.length)];
      ctx.fillText(char, i * fontSize, drops[i] * fontSize);
      if (drops[i] * fontSize > canvas.height && Math.random() > 0.975) {
        drops[i] = 0;
      }
      drops[i]++;
    }
  }

  setInterval(draw, 45);
}

/* ══════════════════════════════════════
   LIVE CLOCK
══════════════════════════════════════ */

function initClock() {
  function tick() {
    const d = new Date();
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    const ss = String(d.getSeconds()).padStart(2, '0');
    const el = document.getElementById('sysTime');
    if (el) el.textContent = `${hh}:${mm}:${ss}`;
  }
  tick();
  setInterval(tick, 1000);
}

/* ══════════════════════════════════════
   THEME TOGGLE
══════════════════════════════════════ */

function initTheme() {
  const btn = document.getElementById('themeToggle');
  const savedTheme = localStorage.getItem('kg_theme') || 'dark';
  document.documentElement.setAttribute('data-theme', savedTheme);

  btn.addEventListener('click', () => {
    const current = document.documentElement.getAttribute('data-theme');
    const next    = current === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    localStorage.setItem('kg_theme', next);
  });
}

/* ══════════════════════════════════════
   PASSWORD STRENGTH METER
══════════════════════════════════════ */

/**
 * Evaluates password strength on a 1-5 scale.
 * Checks: length, uppercase, lowercase, numbers, special chars.
 */
function evalPasswordStrength(password) {
  let score = 0;
  const labels = ['', 'WEAK', 'FAIR', 'GOOD', 'STRONG', 'ELITE'];

  if (password.length >= 8)   score++;
  if (password.length >= 12)  score++;
  if (/[A-Z]/.test(password)) score++;
  if (/[0-9]/.test(password)) score++;
  if (/[^A-Za-z0-9]/.test(password)) score++;

  const fill  = document.getElementById('strengthFill');
  const label = document.getElementById('strengthLabel');
  if (fill)  { fill.setAttribute('data-level', score); }
  if (label) { label.textContent = labels[score] || '—'; }

  return score;
}

/* ══════════════════════════════════════
   KEYSTROKE CAPTURE ENGINE
══════════════════════════════════════ */

/**
 * Attaches keystroke timing listeners to a password input.
 * Captures dwell time (hold) and flight time (key-to-key gap).
 *
 * @param {HTMLInputElement} input  - The target field
 * @param {object}           target - state.login or state.reg
 * @param {Function}         onUpdate - callback after each keystroke
 */
function attachKeystrokeCapture(input, target, onUpdate) {

  // Prevent paste (security measure)
  input.addEventListener('paste', e => {
    e.preventDefault();
    toast('PASTE BLOCKED', 'Paste is disabled in password fields', 'warning', 3000);
  });

  // Disable right-click context menu
  input.addEventListener('contextmenu', e => e.preventDefault());

  input.addEventListener('keydown', e => {
    const now = performance.now();

    // Record start time on first keystroke
    if (!target.startTime) target.startTime = now;

    // Calculate flight time (gap from last keyup to this keydown)
    if (target.lastKeyup !== null) {
      const flight = now - target.lastKeyup;
      target.flightTimes.push(flight);

      // Detect suspiciously fast typing (possible paste via JS injection)
      if (flight < CONFIG.pasteDetectionThreshold && target.flightTimes.length > 2) {
        if (flight < 20) {
          logAlert('warn', '⚡', 'Abnormally fast key sequence detected');
        }
      }
    }

    // Store keydown timestamp for dwell calculation
    target.keydownTimes[e.code] = now;
    target.charCount = (target.charCount || 0) + 1;
  });

  input.addEventListener('keyup', e => {
    const now = performance.now();
    target.lastKeyup = now;

    // Calculate dwell time for this key
    if (target.keydownTimes[e.code] !== undefined) {
      const dwell = now - target.keydownTimes[e.code];
      target.dwellTimes.push(dwell);
      delete target.keydownTimes[e.code];
    }

    if (onUpdate) onUpdate();
  });
}

/**
 * Extracts a biometric profile from a completed keystroke session.
 * Returns normalized metrics ready for comparison.
 *
 * @param {object} session - Captured keystroke state object
 * @param {number} pwLength - Expected password character length
 * @returns {object} Biometric profile
 */
function extractProfile(session, pwLength) {
  const dwell  = session.dwellTimes;
  const flight = session.flightTimes;
  const elapsed = performance.now() - session.startTime;

  // Words Per Minute — treating 5 chars as 1 "word"
  const wpm = pwLength > 0
    ? Math.round((pwLength / 5) / (elapsed / 60000))
    : 0;

  return {
    wpm,
    avgDwell:    avg(dwell),
    stdDwell:    std(dwell),
    avgFlight:   avg(flight),
    stdFlight:   std(flight),
    totalTime:   elapsed,
    dwellTimes:  [...dwell],
    flightTimes: [...flight],
  };
}

/**
 * Compares a live login profile against the stored biometric average.
 * Returns an overall similarity score 0-100 (higher = more similar).
 *
 * Algorithm:
 *  For each metric, compute the relative % difference and convert to
 *  a 0-100 similarity score using an exponential decay function.
 *  Final score is a weighted average per CONFIG.weights.
 */
function compareProfiles(live, registered) {
  // Similarity function: 100 * e^(-k * |diff| / baseline)
  function sim(liveVal, regVal, sensitivity = 0.03) {
    if (regVal === 0) return live === 0 ? 100 : 50;
    const diff = Math.abs(liveVal - regVal);
    return Math.round(100 * Math.exp(-sensitivity * (diff / regVal) * 100));
  }

  const wpmScore    = sim(live.wpm,       registered.wpm,       0.02);
  const dwellScore  = sim(live.avgDwell,  registered.avgDwell,  0.025);
  const flightScore = sim(live.avgFlight, registered.avgFlight, 0.025);

  const overall = Math.round(
    (wpmScore    * CONFIG.weights.wpm    +
     dwellScore  * CONFIG.weights.dwell  +
     flightScore * CONFIG.weights.flight) / 100
  );

  return {
    overall: Math.min(100, Math.max(0, overall)),
    wpmScore:    Math.min(100, Math.max(0, wpmScore)),
    dwellScore:  Math.min(100, Math.max(0, dwellScore)),
    flightScore: Math.min(100, Math.max(0, flightScore)),
  };
}

/* ══════════════════════════════════════
   UTILITY: MATH
══════════════════════════════════════ */

function avg(arr) {
  if (!arr || arr.length === 0) return 0;
  return arr.reduce((s, v) => s + v, 0) / arr.length;
}

function std(arr) {
  if (!arr || arr.length < 2) return 0;
  const mean = avg(arr);
  const variance = arr.reduce((s, v) => s + Math.pow(v - mean, 2), 0) / arr.length;
  return Math.sqrt(variance);
}

/* ══════════════════════════════════════
   LOCAL STORAGE HELPERS
══════════════════════════════════════ */

async function saveAlert(entry) {
  if (!state.currentUser) return;
  await apiRequest(`/users/${encodeURIComponent(state.currentUser)}/alerts`, 'POST', entry);
}

async function loadAlerts() {
  if (!state.currentUser) return [];
  const result = await apiRequest(`/users/${encodeURIComponent(state.currentUser)}/alerts`, 'GET');
  return result.success ? result.alerts : [];
}

/* ══════════════════════════════════════
   SECURITY ALERT LOGGER
══════════════════════════════════════ */

let alertLog = [];

function logAlert(type, icon, message) {
  const entry = {
    type,
    icon,
    message,
    time: new Date().toLocaleTimeString(),
    createdAt: Date.now(),
  };
  alertLog.unshift(entry);
  saveAlert(entry).catch(() => {
    // If backend persistence fails, keep local UI alerts visible.
  });
  renderAlerts();
}

function renderAlerts() {
  const list  = document.getElementById('alertsList');
  const badge = document.getElementById('alertCount');
  if (!list) return;

  badge.textContent = alertLog.length;

  if (alertLog.length === 0) {
    list.innerHTML = '<div class="empty-state">No alerts recorded</div>';
    return;
  }

  list.innerHTML = alertLog.slice(0, 20).map(a => `
    <div class="alert-item ${a.type}">
      <span class="alert-icon">${a.icon}</span>
      <span class="alert-text">${a.message}</span>
      <span class="alert-time">${a.time}</span>
    </div>`
  ).join('');
}

function clearAlerts() {
  alertLog = [];
  renderAlerts();
  toast('Log cleared', 'Security alert log has been purged', 'info');
}

/* ══════════════════════════════════════
   HACKER OVERLAY
══════════════════════════════════════ */

const hackerMessages = [
  '> Scanning biometric profile...',
  '> Keystroke pattern mismatch detected',
  '> Dwell time deviation: CRITICAL',
  '> Flight time anomaly: 340% above baseline',
  '> WPM variance exceeds tolerance',
  '> Possible unauthorized access attempt',
  '> Initiating security protocol ALPHA',
  '> Alerting registered user...',
  '> Session flagged for review',
];

function showHackerOverlay() {
  const overlay = document.getElementById('hackerOverlay');
  const linesEl = document.getElementById('hackerLines');
  overlay.classList.remove('hidden');
  linesEl.textContent = '';

  // Typewriter-style reveal of hacker messages
  let i = 0;
  const interval = setInterval(() => {
    if (i >= hackerMessages.length) { clearInterval(interval); return; }
    linesEl.textContent += hackerMessages[i] + '\n';
    i++;
  }, 300);

  // Play alert sound
  playAlertSound();
}

function closeHackerOverlay() {
  document.getElementById('hackerOverlay').classList.add('hidden');
}

/* ══════════════════════════════════════
   SOUND EFFECTS
══════════════════════════════════════ */

/**
 * Generates a synthesized alert beep using the Web Audio API.
 * No external audio files needed — browser native.
 */
function playAlertSound() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = 'square';
    osc.frequency.setValueAtTime(880, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(220, ctx.currentTime + 0.3);
    gain.gain.setValueAtTime(0.15, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.3);
  } catch (e) {
    // AudioContext not available — silently skip
  }
}

function playSuccessSound() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    [523, 659, 784].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.1, ctx.currentTime + i * 0.1);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + i * 0.1 + 0.15);
      osc.start(ctx.currentTime + i * 0.1);
      osc.stop(ctx.currentTime + i * 0.1 + 0.15);
    });
  } catch (e) {}
}

/* ══════════════════════════════════════
   REGISTRATION FLOW
══════════════════════════════════════ */

function initRegistration() {
  const pwInput  = document.getElementById('regPassword');
  const cfmInput = document.getElementById('regPasswordConfirm');

  // Password strength meter
  pwInput.addEventListener('input', () => {
    evalPasswordStrength(pwInput.value);
  });

  // Keystroke capture on confirm field
  attachKeystrokeCapture(cfmInput, state.reg, () => {
    // Real-time rhythm viz could go here
  });

  // When user finishes typing each sample attempt
  cfmInput.addEventListener('keydown', async e => {
    if (e.key !== 'Enter') return;
    e.preventDefault();

    const password = document.getElementById('regPassword').value;
    const sample   = cfmInput.value;

    if (sample !== password) {
      toast('Mismatch', 'Password does not match — try again', 'error');
      cfmInput.value = '';
      resetRegSession();
      return;
    }

    if (state.reg.dwellTimes.length < 3) {
      toast('Too short', 'Type the full password for biometric capture', 'warning');
      cfmInput.value = '';
      resetRegSession();
      return;
    }

    // Save this sample
    const profile = extractProfile(state.reg, sample.length);
    state.reg.samples.push(profile);

    // Update UI
    const sampleEl = document.getElementById(`sample${state.reg.currentSample}`);
    if (sampleEl) {
      sampleEl.classList.add('captured');
      sampleEl.querySelector('.sample-fill').style.width = '100%';
      sampleEl.querySelector('.sample-status').textContent = 'CAPTURED';
    }

    document.getElementById('bioProgress').textContent =
      `${state.reg.currentSample}/3`;

    state.reg.currentSample++;

    if (state.reg.currentSample <= 3) {
      document.getElementById('sampleCount').textContent = state.reg.currentSample;
      cfmInput.value = '';
      resetRegSession();
      toast('Sample captured', `Collected ${state.reg.currentSample - 1}/3 samples`, 'success', 2500);
    } else {
      // All 3 samples done — ready to register
      cfmInput.value = '';
      document.getElementById('sampleCount').textContent = '✓';
      toast('Biometric enrollment complete', '3 samples collected', 'success');
    }
  });

  document.getElementById('btnRegister').addEventListener('click', handleRegister);
}

function resetRegSession() {
  state.reg.keydownTimes = {};
  state.reg.dwellTimes   = [];
  state.reg.flightTimes  = [];
  state.reg.lastKeyup    = null;
  state.reg.startTime    = null;
}

async function handleRegister() {
  const username = document.getElementById('regUsername').value.trim();
  const email    = document.getElementById('regEmail').value.trim();
  const password = document.getElementById('regPassword').value;

  if (!username || !email || !password) {
    toast('Missing fields', 'Username, email and password are required', 'error');
    return;
  }

  if (state.reg.samples.length < 3) {
    toast('Enrollment incomplete', 'Please capture all 3 biometric samples (press Enter after each)', 'warning');
    return;
  }

  setLoading('#btnRegister', true);
  await delay(800); // simulated processing

  const regProfile = {
    wpm:       avg(state.reg.samples.map(s => s.wpm)),
    avgDwell:  avg(state.reg.samples.map(s => s.avgDwell)),
    stdDwell:  avg(state.reg.samples.map(s => s.stdDwell)),
    avgFlight: avg(state.reg.samples.map(s => s.avgFlight)),
    stdFlight: avg(state.reg.samples.map(s => s.stdFlight)),
    sampleCount: state.reg.samples.length,
  };

  const payload = {
    username,
    email,
    password,
    biometric: regProfile,
    createdAt: Date.now(),
  };

  const result = await apiRequest('/users/register', 'POST', payload);
  setLoading('#btnRegister', false);

  if (!result.success) {
    toast('Registration failed', result.error, 'error');
    return;
  }

  state.currentUser = username;
  state.currentUserData = result.user;

  toast('Identity enrolled!', `Welcome, ${username}. Your biometric profile is saved.`, 'success', 5000);
  playSuccessSound();

  // Reset registration state
  state.reg.samples = [];
  state.reg.currentSample = 1;
  setTimeout(() => showPage('login'), 1500);
}

/* ══════════════════════════════════════
   LOGIN FLOW
══════════════════════════════════════ */

function initLogin() {
  const pwInput = document.getElementById('loginPassword');

  // Prevent paste on login password field too
  attachKeystrokeCapture(pwInput, state.login, updateLoginMetrics);

  document.getElementById('btnLogin').addEventListener('click', handleLogin);

  // Allow pressing Enter to submit
  pwInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') handleLogin();
  });

  // Password visibility toggle
  document.getElementById('toggleLoginPass').addEventListener('click', () => {
    pwInput.type = pwInput.type === 'password' ? 'text' : 'password';
  });
}

/** Updates the real-time WPM and confidence display during login typing */
function updateLoginMetrics() {
  const pw      = document.getElementById('loginPassword').value;
  const elapsed = (performance.now() - (state.login.startTime || performance.now())) / 1000;
  const wpm     = pw.length > 0 ? Math.round((pw.length / 5) / (elapsed / 60)) : 0;

  document.getElementById('loginWpm').textContent = wpm || '—';

  // Rhythm dots visualization
  const rhythmEl = document.getElementById('loginRhythm');
  rhythmEl.innerHTML = '';
  const dotCount = Math.min(8, state.login.flightTimes.length + 1);
  for (let i = 0; i < dotCount; i++) {
    const dot = document.createElement('div');
    dot.className = 'rhythm-dot' + (i === dotCount - 1 ? ' active' : '');
    rhythmEl.appendChild(dot);
  }

  // Rough real-time confidence based on how many keys typed
  const keysTyped = state.login.dwellTimes.length;
  const conf = keysTyped < 4 ? '—' : Math.min(99, Math.round(60 + keysTyped * 3)) + '%';
  document.getElementById('loginConf').textContent = conf;
}

async function handleLogin() {
  // Check lockout
  if (Date.now() < state.lockoutUntil) {
    const remaining = Math.ceil((state.lockoutUntil - Date.now()) / 1000);
    toast('Account locked', `Try again in ${remaining} seconds`, 'error');
    return;
  }

  const emailOrUsername = document.getElementById('loginUsername').value.trim();
  const password = document.getElementById('loginPassword').value;

  if (!emailOrUsername || !password) {
    toast('Missing fields', 'Enter username and password', 'warning');
    return;
  }

  setLoading('#btnLogin', true);
  await delay(600);

  const auth = await apiRequest('/users/login', 'POST', {
    emailOrUsername,
    password,
  });

  setLoading('#btnLogin', false);
  if (!auth.success) {
    recordFailedAttempt();
    toast('Access denied', auth.error, 'error');
    return;
  }

  const user = auth.user;
  const liveProfile = extractProfile(state.login, password.length);
  const scores = compareProfiles(liveProfile, user.biometric);

  await apiRequest(`/users/${encodeURIComponent(user.username)}/metadata`, 'PUT', {
    lastPasswordAttempt: emailOrUsername,
    lastAttemptAt: Date.now(),
    lastLoginProfile: liveProfile,
    lastBiometricScore: scores,
    failedAttempts: scores.overall < CONFIG.biometricThreshold ? (user.failedAttempts || 0) + 1 : 0,
  });

  if (scores.overall < CONFIG.biometricThreshold) {
    // SUSPICIOUS LOGIN
    state.loginAttempts++;
    state.currentUser = user.username;
    state.currentUserData = user;
    alertLog = await loadAlerts();
    logAlert('danger', '⚠', `Biometric mismatch: score ${scores.overall}% (threshold ${CONFIG.biometricThreshold}%)`);

    showHackerOverlay();
    toast('SUSPICIOUS LOGIN DETECTED', `Biometric score: ${scores.overall}%`, 'error', 8000);
    await sendUnauthorizedLoginNotification(user, scores, liveProfile);
    resetLoginSession();
    return;
  }

  // ── SUCCESS ──
  state.loginAttempts = 0;
  state.currentUser = user.username;
  state.currentUserData = user;
  alertLog = await loadAlerts();
  logAlert('info', '◈', `Successful login — biometric score: ${scores.overall}%`);

  playSuccessSound();
  toast('Authentication successful', `Welcome back, ${user.username} — score: ${scores.overall}%`, 'success', 4000);
  resetLoginSession();
  showPage('dashboard');
}

function resetLoginSession() {
  state.login.keydownTimes = {};
  state.login.dwellTimes   = [];
  state.login.flightTimes  = [];
  state.login.lastKeyup    = null;
  state.login.startTime    = null;
  state.login.charCount    = 0;
  document.getElementById('loginPassword').value = '';
  document.getElementById('loginWpm').textContent   = '—';
  document.getElementById('loginConf').textContent  = '—';
  document.getElementById('loginRhythm').innerHTML  = '';
}

/**
 * Manages failed login attempt counter and lockout timer.
 * After maxLoginAttempts failures, the form is locked for lockoutDuration seconds.
 */
function recordFailedAttempt() {
  state.loginAttempts++;
  const bar   = document.getElementById('loginAttemptsBar');
  const dots  = document.getElementById('attemptsDots');
  bar.classList.remove('hidden');

  dots.innerHTML = Array.from({ length: state.loginAttempts }).map(() =>
    `<div class="attempt-dot"></div>`
  ).join('');

  if (state.loginAttempts >= CONFIG.maxLoginAttempts) {
    state.lockoutUntil = Date.now() + CONFIG.lockoutDuration * 1000;
    startLockoutTimer();
    logAlert('danger', '🔒', `Account locked after ${CONFIG.maxLoginAttempts} failed attempts`);
    toast('Account locked', `Too many failures. Locked for ${CONFIG.lockoutDuration}s`, 'error', 0);
  }
}

/** Displays and counts down the lockout timer */
function startLockoutTimer() {
  const el = document.getElementById('lockoutTimer');
  const btn = document.getElementById('btnLogin');

  function tick() {
    const remaining = Math.ceil((state.lockoutUntil - Date.now()) / 1000);
    if (remaining <= 0) {
      el.textContent  = '';
      btn.disabled    = false;
      state.loginAttempts = 0;
      document.getElementById('loginAttemptsBar').classList.add('hidden');
      return;
    }
    el.textContent = `LOCKED: ${remaining}s`;
    btn.disabled   = true;
    setTimeout(tick, 1000);
  }
  tick();
}

/* ══════════════════════════════════════
   PASSWORD SHOW/HIDE TOGGLES
══════════════════════════════════════ */

function initPasswordToggles() {
  document.getElementById('toggleRegPass')?.addEventListener('click', () => {
    const pw = document.getElementById('regPassword');
    pw.type = pw.type === 'password' ? 'text' : 'password';
  });
}

function initAdmin() {
  document.getElementById('btnAdminLogin').addEventListener('click', handleAdminLogin);
  document.getElementById('toggleAdminPass')?.addEventListener('click', () => {
    const pw = document.getElementById('adminPassword');
    pw.type = pw.type === 'password' ? 'text' : 'password';
  });
}

function sanitize(value) {
  return String(value || '—')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

async function apiRequest(path, method = 'GET', body = null) {
  try {
    const options = {
      method,
      headers: { 'Content-Type': 'application/json' },
    };
    if (body) options.body = JSON.stringify(body);

    const response = await fetch(`${API_BASE}${path}`, options);
    const data = await response.json().catch(() => null);
    if (!response.ok) {
      return { success: false, error: data?.message || response.statusText || 'API request failed' };
    }
    return data;
  } catch (err) {
    console.error('[API]', err);
    return { success: false, error: err.message || 'Network error' };
  }
}

function getAllUsers() {
  return Object.keys(localStorage)
    .filter(key => key.startsWith('kg_user_'))
    .map(key => {
      try { return JSON.parse(localStorage.getItem(key)); }
      catch (err) { return null; }
    })
    .filter(Boolean);
}

function collectLocalUsers() {
  return getAllUsers().map(user => ({
    username: user.username,
    email: user.email,
    passwordHash: user.passwordHash,
    biometric: user.biometric,
    createdAt: user.createdAt,
    failedAttempts: user.failedAttempts || 0,
    lastPasswordAttempt: user.lastPasswordAttempt || null,
    lastAttemptAt: user.lastAttemptAt || null,
    lastLoginProfile: user.lastLoginProfile || null,
    lastBiometricScore: user.lastBiometricScore || null,
  }));
}

async function migrateLocalUsersToDb() {
  const users = collectLocalUsers();
  if (users.length === 0) {
    toast('No users found', 'No localStorage user records available to migrate', 'info');
    return;
  }

  const result = await apiRequest('/admin/migrate', 'POST', { users });
  if (!result.success) {
    toast('Migration failed', result.error, 'error');
    return;
  }

  toast('Migration complete', `${result.count} user records saved to MongoDB`, 'success');
  loadAdminUsers();
}

async function loadAdminUsers() {
  const tbody = document.getElementById('adminUserRows');
  if (!tbody) return;

  const result = await apiRequest('/admin/users', 'GET');
  if (!result.success) {
    tbody.innerHTML = '<tr><td colspan="6" class="empty-state">Backend unavailable</td></tr>';
    return;
  }

  const users = result.users || [];
  if (users.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6" class="empty-state">No registered users found</td></tr>';
    return;
  }

  tbody.innerHTML = users.map(user => {
    const created = user.createdAt ? new Date(user.createdAt).toLocaleString() : '—';
    const score = user.lastBiometricScore ? `${user.lastBiometricScore.overall}%` : '—';
    const attempt = user.lastPasswordAttempt ? sanitize(user.lastPasswordAttempt) : '—';
    const lastAttempt = user.lastAttemptAt ? new Date(user.lastAttemptAt).toLocaleString() : '—';
    const wpm = user.biometric?.wpm ? Math.round(user.biometric.wpm) : '—';
    const samples = user.biometric?.sampleCount || '—';
    const failed = user.failedAttempts || 0;
    return `
      <tr>
        <td>${sanitize(user.username)}</td>
        <td>${sanitize(user.email)}</td>
        <td>${sanitize(created)}</td>
        <td>${sanitize(failed)}</td>
        <td>${attempt}</td>
        <td>${sanitize(lastAttempt)}</td>
        <td>${sanitize(wpm)}</td>
        <td>${sanitize(samples)}</td>
        <td>${sanitize(score)}</td>
      </tr>`;
  }).join('');
}

async function handleAdminLogin() {
  const email = document.getElementById('adminEmail').value.trim();
  const password = document.getElementById('adminPassword').value;

  if (!email || !password) {
    toast('Missing fields', 'Admin email and password are required', 'warning');
    return;
  }

  const result = await apiRequest('/admin/login', 'POST', {
    email,
    password,
  });

  if (!result.success) {
    toast('Access denied', result.error, 'error');
    return;
  }

  toast('Admin access granted', 'Loading user records', 'success');
  showPage('admin-panel');
  loadAdminUsers();
}

function logoutAdmin() {
  showPage('login');
}

/* ══════════════════════════════════════
   DASHBOARD
══════════════════════════════════════ */

async function loadDashboard() {
  let user = state.currentUserData;
  if (!user && state.currentUser) {
    const result = await apiRequest(`/users/profile/${encodeURIComponent(state.currentUser)}`, 'GET');
    if (!result.success) {
      toast('Dashboard load failed', result.error, 'error');
      return;
    }
    user = result.user;
    state.currentUserData = user;
  }
  if (!user) return;

  // Profile info
  document.getElementById('dashName').textContent  = user.username.toUpperCase();
  document.getElementById('dashEmail').textContent = user.email;
  document.getElementById('dashAvatar').textContent = user.username[0].toUpperCase();

  // Biometric score ring
  const scores = user.lastBiometricScore;
  if (scores) {
    animateScoreRing(scores.overall);
    document.getElementById('scoreNumber').textContent = `${scores.overall}%`;
    renderScoreBreakdown(scores);
  }

  // Session stats
  const live = user.lastLoginProfile;
  if (live) {
    document.getElementById('statWpm').textContent     = live.wpm || '—';
    document.getElementById('statAccuracy').textContent =
      scores ? `${scores.overall}%` : '—';
    document.getElementById('statDwell').textContent   = Math.round(live.avgDwell) || '—';
    document.getElementById('statFlight').textContent  = Math.round(live.avgFlight) || '—';

    renderKeystrokeChart(live);
  }

  // Registered biometric profile
  const bio = user.biometric;
  if (bio) {
    document.getElementById('regWpm').textContent    = Math.round(bio.wpm) || '—';
    document.getElementById('regDwell').textContent  = Math.round(bio.avgDwell) || '—';
    document.getElementById('regFlight').textContent = Math.round(bio.avgFlight) || '—';
    document.getElementById('regSamples').textContent = bio.sampleCount || '—';
  }

  // EmailJS config pre-fill
  document.getElementById('cfgServiceId').value  = state.email.serviceId;
  document.getElementById('cfgTemplateId').value = state.email.templateId;
  document.getElementById('cfgPublicKey').value  = state.email.publicKey;

  // Load alerts
  renderAlerts();
}

/**
 * Animates the score ring SVG from 0 to the target percentage.
 */
function animateScoreRing(pct) {
  const ring   = document.getElementById('scoreRingFill');
  const circum = 314; // 2π × r(50)
  const offset = circum - (pct / 100) * circum;
  ring.style.strokeDashoffset = offset;

  // Colour: green > 70, orange 40-70, red < 40
  ring.style.stroke =
    pct >= 70 ? 'var(--c-neon)' :
    pct >= 40 ? 'var(--c-warn)' :
                'var(--c-danger)';
}

function renderScoreBreakdown(scores) {
  const container = document.getElementById('scoreBreakdown');
  const rows = [
    { label: 'Speed (WPM)',    val: scores.wpmScore,    color: 'var(--c-neon2)' },
    { label: 'Dwell time',     val: scores.dwellScore,  color: 'var(--c-neon)' },
    { label: 'Flight time',    val: scores.flightScore, color: 'var(--c-neon3)' },
  ];

  container.innerHTML = rows.map(r => `
    <div class="score-row">
      <span class="score-row-label">${r.label}</span>
      <div class="score-row-bar">
        <div class="score-row-fill" style="width:${r.val}%;background:${r.color}"></div>
      </div>
      <span class="score-row-val">${r.val}%</span>
    </div>`
  ).join('');
}

/**
 * Renders a Chart.js bar chart comparing live vs registered keystroke intervals.
 */
function renderKeystrokeChart(liveProfile) {
  const ctx = document.getElementById('keystrokeChart')?.getContext('2d');
  if (!ctx) return;

  if (state.keystrokeChart) {
    state.keystrokeChart.destroy();
  }

  const reg  = state.currentUserData?.biometric;

  const labels   = ['WPM', 'Avg Dwell (÷10)', 'Avg Flight (÷10)'];
  const liveData = [
    liveProfile.wpm,
    Math.round(liveProfile.avgDwell / 10),
    Math.round(liveProfile.avgFlight / 10),
  ];
  const regData = reg ? [
    Math.round(reg.wpm),
    Math.round(reg.avgDwell / 10),
    Math.round(reg.avgFlight / 10),
  ] : [];

  const neon  = getComputedStyle(document.documentElement).getPropertyValue('--c-neon').trim();
  const neon2 = getComputedStyle(document.documentElement).getPropertyValue('--c-neon2').trim();

  state.keystrokeChart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [
        {
          label: 'This Login',
          data: liveData,
          backgroundColor: `${neon}55`,
          borderColor: neon,
          borderWidth: 1.5,
          borderRadius: 4,
        },
        {
          label: 'Registered Profile',
          data: regData,
          backgroundColor: `${neon2}55`,
          borderColor: neon2,
          borderWidth: 1.5,
          borderRadius: 4,
        },
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          labels: {
            color: '#6b9e8a',
            font: { family: "'Share Tech Mono'" },
            boxWidth: 10,
          }
        },
      },
      scales: {
        x: {
          ticks: { color: '#6b9e8a', font: { family: "'Share Tech Mono'", size: 10 } },
          grid: { color: 'rgba(0,230,180,0.06)' },
        },
        y: {
          ticks: { color: '#6b9e8a', font: { family: "'Share Tech Mono'", size: 10 } },
          grid: { color: 'rgba(0,230,180,0.06)' },
        },
      },
    }
  });
}

/* ══════════════════════════════════════
   LOGOUT
══════════════════════════════════════ */

function logout() {
  state.currentUser = null;
  state.currentUserData = null;
  state.loginAttempts = 0;
  if (state.keystrokeChart) {
    state.keystrokeChart.destroy();
    state.keystrokeChart = null;
  }
  toast('Logged out', 'Session terminated', 'info', 2500);
  showPage('login');
}

/* ══════════════════════════════════════
   EMAIL NOTIFICATIONS (EmailJS)
══════════════════════════════════════ */

/**
 * Sends an email alert via EmailJS when suspicious login is detected.
 *
 * SETUP INSTRUCTIONS:
 * 1. Create account at https://www.emailjs.com
 * 2. Add an Email Service (Gmail, Outlook, etc.)
 * 3. Create an Email Template with these variables:
 *    {{to_email}}, {{username}}, {{score}}, {{dwell}}, {{flight}}, {{wpm}}, {{time}}
 * 4. Get your Service ID, Template ID, and Public Key from the dashboard
 * 5. Enter them in the Dashboard → Notification Config panel
 */
async function sendEmailAlert(user, scores, liveProfile) {
  const { serviceId, templateId, publicKey } = state.email;

  if (!serviceId || !templateId || !publicKey) {
    toast('Email not configured', 'Add EmailJS credentials in the dashboard', 'warning', 5000);
    return;
  }

  try {
    emailjs.init(publicKey);
    await emailjs.send(serviceId, templateId, {
      to_email: user.email,
      username: user.username,
      score:    `${scores.overall}%`,
      dwell:    `${Math.round(liveProfile.avgDwell)}ms`,
      flight:   `${Math.round(liveProfile.avgFlight)}ms`,
      wpm:      liveProfile.wpm,
      time:     new Date().toLocaleString(),
    });
    toast('Alert sent', `Security email sent to ${user.email}`, 'success');
  } catch (err) {
    console.error('[KeyGuard] EmailJS error:', err);
    toast('Email failed', `Could not send alert: ${err.text || err.message}`, 'error');
  }
}

function saveEmailConfig() {
  state.email.serviceId  = document.getElementById('cfgServiceId').value.trim();
  state.email.templateId = document.getElementById('cfgTemplateId').value.trim();
  state.email.publicKey  = document.getElementById('cfgPublicKey').value.trim();

  localStorage.setItem('kg_email_service',  state.email.serviceId);
  localStorage.setItem('kg_email_template', state.email.templateId);
  localStorage.setItem('kg_email_pubkey',   state.email.publicKey);

  toast('Config saved', 'EmailJS credentials stored', 'success');
}

async function sendUnauthorizedLoginNotification(user, scores, liveProfile) {
  const result = await apiRequest('/users/suspicious', 'POST', {
    identifier: user.username,
    reason: 'Suspicious biometric mismatch',
    score: scores.overall,
    profile: {
      wpm: liveProfile.wpm,
      avgDwell: Math.round(liveProfile.avgDwell),
      avgFlight: Math.round(liveProfile.avgFlight),
    },
  });

  if (!result.success) {
    toast('Email alert failed', 'Could not send unauthorized login alert', 'warning');
  }
}

async function testEmailAlert() {
  if (!state.currentUser) return;
  let user = state.currentUserData;
  if (!user) {
    const result = await apiRequest(`/users/profile/${encodeURIComponent(state.currentUser)}`, 'GET');
    if (!result.success) return;
    user = result.user;
  }

  sendEmailAlert(
    user,
    { overall: 32, wpmScore: 40, dwellScore: 28, flightScore: 30 },
    { avgDwell: 180, avgFlight: 220, wpm: 85 }
  );
}

/* ══════════════════════════════════════
   TWILIO SMS INTEGRATION (Sample Code)
  ─────────────────────────────────────
  Twilio requires a backend to keep credentials safe.
  Create a serverless function (Node.js / Python) that:

  const twilio = require('twilio');
  const client = twilio(process.env.ACCOUNT_SID, process.env.AUTH_TOKEN);

  async function sendSmsAlert(toPhone, username, score) {
    await client.messages.create({
      body: `KeyGuard Alert: Suspicious login for ${username}. Score: ${score}%`,
      from: '+1XXXXXXXXXX',  // your Twilio number
      to: toPhone
    });
  }

  Then call your endpoint from here:
══════════════════════════════════════ */
async function sendSmsAlert(phone, username, score) {
  // Replace '/api/sms-alert' with your actual backend endpoint
  try {
    await fetch('/api/sms-alert', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone, username, score }),
    });
    toast('SMS sent', `Alert sent to ${phone}`, 'success');
  } catch (e) {
    toast('SMS failed', 'Backend endpoint not configured', 'warning');
  }
}

/* ══════════════════════════════════════
   SIMPLE HASH (Demo Only)
  ─────────────────────────────────────
  This is NOT cryptographically secure.
  In production: use bcrypt/argon2 on a server.
══════════════════════════════════════ */
function simpleHash(str) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = (hash * 0x01000193) >>> 0;
  }
  return hash.toString(16);
}

/* ══════════════════════════════════════
   UTILITIES
══════════════════════════════════════ */

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/* ══════════════════════════════════════
   INITIALISE APPLICATION
══════════════════════════════════════ */

document.addEventListener('DOMContentLoaded', () => {
  initMatrix();
  initClock();
  initTheme();
  initLogin();
  initRegistration();
  initPasswordToggles();
  initAdmin();

  // Boot toast
  setTimeout(() => {
    toast('KEYGUARD ONLINE', 'Biometric authentication system ready', 'success', 3000);
  }, 500);
});