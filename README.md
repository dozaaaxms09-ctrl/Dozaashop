# Dozaashop

A dark, gaming-themed e-commerce site for digital downloads (Free Fire Diamond, eFootball Coin, Flex City).

Quick start

1. Install dependencies
   npm install

2. Copy .env.example to .env and set required values (at minimum MONGO_URI and JWT_SECRET). OWNER_EMAIL is prefilled with dozaaaxms09@gmail.com

3. Seed sample products (optional)
   node scripts/seed.js

4. Run dev server
   npm run dev

5. Open http://localhost:4242

Notes
- Payment providers (Stripe/PayPal) and storage (S3) require API keys. Fill them in .env to enable.
- For Cash App payments, a manual flow is included (owner verifies payments). See docs in README.
