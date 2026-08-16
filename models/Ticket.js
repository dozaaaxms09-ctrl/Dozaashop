const mongoose = require('mongoose');
const { Schema } = mongoose;

const TicketSchema = new Schema({
  email: String,
  subject: String,
  message: String,
  status: { type: String, default: 'open' },
  replies: [{ message: String, createdAt: Date }],
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Ticket', TicketSchema);
