const express = require('express');
const bcrypt = require('bcryptjs');
const nodemailer = require('nodemailer');
const router = express.Router();
const User = require('../models/User');
const Alert = require('../models/Alert');

const mailTransporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT) || 587,
  secure: false,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

console.log("SMTP_USER:", process.env.SMTP_USER);
console.log("SMTP_PASS:", process.env.SMTP_PASS?.length);

// Verify connection on startup
mailTransporter.verify((error, success) => {
  if (error) {
    console.error('[Nodemailer] SMTP connection failed:', error.message);
  } else if (success) {
    console.log('[Nodemailer] SMTP connection verified and ready to send emails');
  }
});

function emailConfigReady() {
  return process.env.SMTP_HOST && process.env.SMTP_PORT && process.env.SMTP_USER && process.env.SMTP_PASS && process.env.EMAIL_FROM;
}

async function sendUnauthorizedLoginEmail(user, reason, details = '') {
  if (!user || !user.email) {
    console.warn('[Nodemailer] Missing user or user email');
    return;
  }

  if (!emailConfigReady()) {
    console.warn('[Nodemailer] SMTP configuration incomplete. Check SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, and EMAIL_FROM in .env');
    return;
  }

  const mailOptions = {
    from: process.env.EMAIL_FROM,
    to: user.email,
    subject: 'Unauthorized login attempt detected',
    text: `Hello ${user.username},

We detected an unauthorized login attempt for your account.

Reason: ${reason}
${details ? `Details: ${details}
` : ''}
If you did not attempt to sign in, please change your password immediately and contact support.

Regards,
KeyGuard Security Team`,
    html: `<p>Hello <strong>${user.username}</strong>,</p>
<p>We detected an unauthorized login attempt for your account.</p>
<p><strong>Reason:</strong> ${reason}</p>
${details ? `<p><strong>Details:</strong> ${details}</p>` : ''}
<p>If you did not attempt to sign in, please change your password immediately and contact support.</p>
<p>Regards,<br/>KeyGuard Security Team</p>`,
  };

  try {
    const info = await mailTransporter.sendMail(mailOptions);
    console.log('[Nodemailer] Email sent successfully to', user.email, 'MessageId:', info.messageId);
  } catch (err) {
    console.error('[Nodemailer] Failed to send email to', user.email);
    console.error('[Nodemailer] Error:', err.message);
    if (err.response) {
      console.error('[Nodemailer] SMTP Response:', err.response);
    }
  }
}

router.post('/register', async (req, res) => {
  let { username, email, password, biometric, createdAt } = req.body;

  if (!username || !email || !password) {
    return res.status(400).json({
      success: false,
      message: 'Missing username, email, or password'
    });
  }

  // Normalize email
  email = email.toLowerCase().trim();

  // Add @gmail.com if missing
  if (!email.endsWith('@gmail.com')) {
    email += '@gmail.com';
  }

  const existing = await User.findOne({
    $or: [{ username }, { email }]
  });

  if (existing) {
    return res.status(409).json({
      success: false,
      message: 'Username or email already exists'
    });
  }

  const passwordHash = await bcrypt.hash(password, 12);

  const user = new User({
    username,
    email,
    passwordHash,
    biometric,
    createdAt
  });

  await user.save();

  const safeUser = user.toObject();
  delete safeUser.passwordHash;

  res.json({
    success: true,
    user: safeUser
  });
});

router.post('/login', async (req, res) => {
  let { emailOrUsername, password } = req.body;

  if (!emailOrUsername || !password) {
    return res.status(400).json({
      success: false,
      message: 'Email or username and password are required'
    });
  }

  // Remove spaces and convert to lowercase
  emailOrUsername = emailOrUsername.trim().toLowerCase();

  // If user entered only name, add @gmail.com
  let emailToSearch = emailOrUsername;
  if (!emailOrUsername.includes('@')) {
    emailToSearch = emailOrUsername + '@gmail.com';
  }

  const user = await User.findOne({
    $or: [
      { username: emailOrUsername }, // login by username
      { email: emailToSearch }       // login by email
    ]
  });

  if (!user) {
    return res.status(404).json({
      success: false,
      message: 'Unknown user'
    });
  }

  const passwordMatches = await bcrypt.compare(
    password,
    user.passwordHash
  );

  if (!passwordMatches) {
    user.failedAttempts = (user.failedAttempts || 0) + 1;
    user.lastPasswordAttempt = emailOrUsername;
    user.lastAttemptAt = Date.now();

    await user.save();

    await sendUnauthorizedLoginEmail(
      user,
      'Incorrect password entered',
      `Identifier used: ${emailOrUsername}`
    );

    return res.status(401).json({
      success: false,
      message: 'Incorrect password'
    });
  }

  const safeUser = user.toObject();
  delete safeUser.passwordHash;

  res.json({
    success: true,
    user: safeUser
  });
});

router.get('/profile/:identifier', async (req, res) => {
  const { identifier } = req.params;
  const user = await User.findOne({
    $or: [
      { username: identifier },
      { email: identifier.toLowerCase() },
    ]
  });

  if (!user) {
    return res.status(404).json({ success: false, message: 'User not found' });
  }

  const safeUser = user.toObject();
  delete safeUser.passwordHash;
  res.json({ success: true, user: safeUser });
});

router.put('/:username/metadata', async (req, res) => {
  const { username } = req.params;
  const updates = req.body;

  const user = await User.findOne({ username });
  if (!user) {
    return res.status(404).json({ success: false, message: 'User not found' });
  }

  const allowedFields = ['biometric', 'lastLoginProfile', 'lastBiometricScore', 'failedAttempts', 'lastAttemptAt', 'lastPasswordAttempt'];
  allowedFields.forEach(field => {
    if (Object.prototype.hasOwnProperty.call(updates, field)) {
      user[field] = updates[field];
    }
  });

  await user.save();
  const safeUser = user.toObject();
  delete safeUser.passwordHash;
  res.json({ success: true, user: safeUser });
});

router.get('/:username/alerts', async (req, res) => {
  const { username } = req.params;
  const alerts = await Alert.find({ username: username.toLowerCase() }).sort({ createdAt: -1 }).lean();
  res.json({ success: true, alerts });
});

router.post('/suspicious', async (req, res) => {
  const { identifier, reason, score, profile } = req.body;
  if (!identifier) {
    return res.status(400).json({ success: false, message: 'Identifier is required' });
  }

  const user = await User.findOne({
    $or: [
      { username: identifier },
      { email: identifier.toLowerCase() },
    ]
  });

  if (!user) {
    return res.status(404).json({ success: false, message: 'User not found' });
  }

  const details = `Biometric score: ${score || 'N/A'}${profile ? `; WPM: ${profile.wpm}; dwell: ${profile.avgDwell}; flight: ${profile.avgFlight}` : ''}`;
  await sendUnauthorizedLoginEmail(user, reason || 'Suspicious biometric match', details);
  res.json({ success: true, message: 'Unauthorized login email sent' });
});

router.post('/:username/alerts', async (req, res) => {
  const { username } = req.params;
  const { type, icon, message, createdAt } = req.body;

  if (!type || !icon || !message) {
    return res.status(400).json({ success: false, message: 'Alert type, icon, and message are required' });
  }

  const alert = new Alert({
    username: username.toLowerCase(),
    type,
    icon,
    message,
    createdAt: createdAt || Date.now(),
  });

  await alert.save();
  res.json({ success: true, alert });
});

module.exports = router;
