const mongoose = require('mongoose');

const alertSchema = new mongoose.Schema({
  username: { type: String, required: true, trim: true, lowercase: true },
  type: { type: String, required: true },
  icon: { type: String, required: true },
  message: { type: String, required: true },
  createdAt: { type: Number, default: Date.now },
}, {
  versionKey: false,
});

module.exports = mongoose.model('Alert', alertSchema);
