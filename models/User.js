const mongoose = require('mongoose');
const { Schema } = mongoose;

const UserSchema = new Schema({
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  passwordHash: { type: String, required: true },
  role: { type: String, enum: ['user', 'admin', 'owner'], default: 'user' },
  createdAt: { type: Date, default: Date.now },
  wallet_cents: { type: Number, default: 0 }
});

module.exports = mongoose.model('User', UserSchema);
