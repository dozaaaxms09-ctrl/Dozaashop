const mongoose = require('mongoose');
const { Schema } = mongoose;

const ProductSchema = new Schema({
  name: String,
  price_cents: Number,
  description: String,
  file_key: String,
  cover_image: String
});

module.exports = mongoose.model('Product', ProductSchema);
