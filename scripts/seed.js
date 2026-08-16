// Seed script for sample products
require('dotenv').config();
const mongoose = require('mongoose');
const Product = require('../models/Product');

async function seed() {
  await mongoose.connect(process.env.MONGO_URI);
  await Product.deleteMany({});
  const products = [
    { name: 'Free Fire Diamond', price_cents: 499, description: 'Top-up Free Fire diamonds pack', file_key: '', cover_image: '/placeholder.jpg' },
    { name: 'eFootball Coin', price_cents: 299, description: 'eFootball coin bundle', file_key: '', cover_image: '/placeholder.jpg' },
    { name: 'Flex City', price_cents: 199, description: 'Flex City game credits', file_key: '', cover_image: '/placeholder.jpg' }
  ];
  for (const p of products) await Product.create(p);
  console.log('Seeded products');
  process.exit(0);
}

seed().catch(e => { console.error(e); process.exit(1); });
