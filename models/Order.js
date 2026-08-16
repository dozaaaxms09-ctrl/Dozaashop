const mongoose = require('mongoose');
const { Schema } = mongoose;

const OrderSchema = new Schema({
  product: { type: Schema.Types.ObjectId, ref: 'Product' },
  amount_cents: Number,
  currency: { type: String, default: 'usd' },
  provider: String,
  provider_payment_id: String,
  paid: { type: Boolean, default: false },
  download_token: String,
  download_token_expires: Date,
  createdAt: { type: Date, default: Date.now },
  email: String
});

module.exports = mongoose.model('Order', OrderSchema);
