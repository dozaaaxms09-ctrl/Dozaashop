const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const User = require('../models/User');

const router = express.Router();

function signToken(user) {
  return jwt.sign({ id: user._id, role: user.role, email: user.email }, process.env.JWT_SECRET, { expiresIn: '7d' });
}

// Register
router.post('/register', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email and password required' });

  const existing = await User.findOne({ email });
  if (existing) return res.status(400).json({ error: 'User already exists' });

  const passwordHash = await bcrypt.hash(password, 10);
  const user = new User({ email, passwordHash });

  if (process.env.OWNER_EMAIL && process.env.OWNER_EMAIL.toLowerCase() === email.toLowerCase()) {
    user.role = 'owner';
  } else {
    const ownerExists = await User.exists({ role: 'owner' });
    if (!ownerExists) user.role = 'owner';
  }

  await user.save();
  const token = signToken(user);
  res.json({ token, user: { id: user._id, email: user.email, role: user.role } });
});

// Login
router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email and password required' });

  const user = await User.findOne({ email });
  if (!user) return res.status(400).json({ error: 'Invalid credentials' });

  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) return res.status(400).json({ error: 'Invalid credentials' });

  const token = signToken(user);
  res.json({ token, user: { id: user._id, email: user.email, role: user.role } });
});

// Me
router.get('/me', async (req, res) => {
  const auth = req.headers.authorization;
  if (!auth) return res.json({ user: null });
  try {
    const token = auth.split(' ')[1];
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(payload.id).select('-passwordHash');
    return res.json({ user });
  } catch (e) {
    return res.json({ user: null });
  }
});

module.exports = router;
