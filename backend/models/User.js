const mongoose = require('mongoose');

const biometricSchema = new mongoose.Schema({
  wpm: { type: Number, default: 0 },
  avgDwell: { type: Number, default: 0 },
  stdDwell: { type: Number, default: 0 },
  avgFlight: { type: Number, default: 0 },
  stdFlight: { type: Number, default: 0 },
  sampleCount: { type: Number, default: 0 },
}, { _id: false });

const profileSchema = new mongoose.Schema({
  wpm: { type: Number, default: 0 },
  avgDwell: { type: Number, default: 0 },
  stdDwell: { type: Number, default: 0 },
  avgFlight: { type: Number, default: 0 },
  stdFlight: { type: Number, default: 0 },
}, { _id: false });

const scoreSchema = new mongoose.Schema({
  overall: { type: Number, default: 0 },
  wpmScore: { type: Number, default: 0 },
  dwellScore: { type: Number, default: 0 },
  flightScore: { type: Number, default: 0 },
}, { _id: false });

const userSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true, trim: true },
  email: { type: String, required: true, unique: true, trim: true, lowercase: true },
  passwordHash: { type: String, required: true },
  biometric: { type: biometricSchema, default: {} },
  createdAt: { type: Number, default: Date.now },
  failedAttempts: { type: Number, default: 0 },
  lastPasswordAttempt: { type: String, default: '' },
  lastAttemptAt: { type: Number, default: null },
  lastLoginProfile: { type: profileSchema, default: {} },
  lastBiometricScore: { type: scoreSchema, default: {} },
}, {
  timestamps: true,
});

module.exports = mongoose.model('User', userSchema);
