const express = require('express');
const router = express.Router();
const User = require('../models/User');

router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ success: false, message: 'Admin email and password are required' });
  }

  const adminEmail = process.env.ADMIN_EMAIL || 'rajanauthorization@gmail.com';
  const adminPassword = process.env.ADMIN_PASSWORD || 'access007';

  if (email.toLowerCase() !== adminEmail.toLowerCase() || password !== adminPassword) {
    return res.status(401).json({ success: false, message: 'Invalid admin credentials' });
  }

  res.json({ success: true, message: 'Admin authenticated' });
});

router.get('/users', async (req, res) => {
  const users = await User.find().lean().select('-__v -passwordHash');
  res.json({ success: true, users });
});

router.post('/migrate', async (req, res) => {
  const { users } = req.body;
  if (!Array.isArray(users)) {
    return res.status(400).json({ success: false, message: 'Users array is required' });
  }

  let count = 0;
  for (const userData of users) {
    if (!userData.username || !userData.email || !userData.passwordHash) {
      continue;
    }

    const query = {
      $or: [
        { username: userData.username },
        { email: userData.email.toLowerCase() },
      ],
    };

    const existing = await User.findOne(query);
    if (existing) {
      Object.assign(existing, userData);
      existing.email = userData.email.toLowerCase();
      await existing.save();
    } else {
      const created = new User({
        ...userData,
        email: userData.email.toLowerCase(),
      });
      await created.save();
    }
    count += 1;
  }

  res.json({ success: true, count });
});

module.exports = router;
