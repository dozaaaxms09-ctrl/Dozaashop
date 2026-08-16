const express = require('express');
const mongoose = require('mongoose');
const Stripe = require('stripe');
const paypal = require('@paypal/checkout-server-sdk');
const bodyParser = require('body-parser');
const cors = require('cors');
const aws = require('aws-sdk');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const fs = require('fs');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 4242;
const stripe = process.env.STRIPE_SECRET_KEY ? Stripe(process.env.STRIPE_SECRET_KEY) : null;

// PayPal client helper
function paypalClient() {
  return new paypal.core.PayPalHttpClient(
    new paypal.core.SandboxEnvironment(process.env.PAYPAL_CLIENT_ID || '', process.env.PAYPAL_CLIENT_SECRET || '')
  );
}

// S3
const s3 = new aws.S3({
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  region: process.env.AWS_REGION
});

// Connect DB
mongoose.connect(process.env.MONGO_URI, { useNewUrlParser: true, useUnifiedTopology: true }).then(() => {
  console.log('MongoDB connected');
}).catch(err => console.error('MongoDB error', err));

// Models
const User = require('./models/User');
const Product = require('./models/Product');
const Order = require('./models/Order');
const Ticket = require('./models/Ticket');

// Auth routes + middleware
const authRoutes = require('./routes/auth');
const { authMiddleware, requireAdmin, requireOwner } = require('./middleware/auth');

app.use(cors());
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));

app.use('/api/auth', authRoutes);

// API: list products
app.get('/api/products', async (req, res) => {
  const products = await Product.find();
  res.json(products);
});

// Create Stripe Checkout session
app.post('/api/stripe/checkout', async (req, res) => {
  if (!stripe) return res.status(500).json({ error: 'Stripe not configured' });
  const { productId, email } = req.body;
  const product = await Product.findById(productId);
  if (!product) return res.status(404).json({ error: 'Product not found' });

  const order = new Order({
    product: product._id,
    amount_cents: product.price_cents,
    provider: 'stripe',
    email
  });
  await order.save();

  const session = await stripe.checkout.sessions.create({
    payment_method_types: ['card'],
    line_items: [{
      price_data: {
        currency: 'usd',
        product_data: { name: product.name, description: product.description },
        unit_amount: product.price_cents
      },
      quantity: 1
    }],
    mode: 'payment',
    success_url: `${process.env.FRONTEND_URL}/success.html?orderId=${order._id}`,
    cancel_url: `${process.env.FRONTEND_URL}/cancel.html`,
    metadata: { orderId: order._id.toString(), productId: product._id.toString(), email }
  });
  res.json({ url: session.url });
});

// Stripe webhook to fulfill orders
app.post('/webhook/stripe', bodyParser.raw({ type: 'application/json' }), async (req, res) => {
  if (!stripe) return res.status(500).send('Stripe not configured');
  const sig = req.headers['stripe-signature'];
  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (e) {
    console.error('Stripe webhook signature error', e.message);
    return res.status(400).send(`Webhook Error: ${e.message}`);
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const metadata = session.metadata || {};
    const orderId = metadata.orderId;
    const order = await Order.findById(orderId).populate('product');
    if (order && !order.paid) {
      order.paid = true;
      order.provider_payment_id = session.payment_intent;
      order.download_token = uuidv4();
      order.download_token_expires = new Date(Date.now() + 1000 * 60 * 60);
      await order.save();
      // TODO: send email with link to order.email
    }
  }
  res.json({ received: true });
});

// Create PayPal order
app.post('/api/paypal/create-order', async (req, res) => {
  const { productId, email } = req.body;
  const product = await Product.findById(productId);
  if (!product) return res.status(404).json({ error: 'Product not found' });

  const order = new Order({
    product: product._id,
    amount_cents: product.price_cents,
    provider: 'paypal',
    email
  });
  await order.save();

  const request = new paypal.orders.OrdersCreateRequest();
  request.prefer('return=representation');
  request.requestBody({
    intent: 'CAPTURE',
    purchase_units: [{
      amount: { currency_code: 'USD', value: (product.price_cents / 100).toFixed(2) },
      custom_id: order._id.toString()
    }],
    application_context: {
      return_url: `${process.env.FRONTEND_URL}/success.html?orderId=${order._id}`,
      cancel_url: `${process.env.FRONTEND_URL}/cancel.html`
    }
  });

  try {
    const client = paypalClient();
    const response = await client.execute(request);
    res.json({ id: response.result.id, links: response.result.links });
  } catch (e) {
    console.error('PayPal create-order error', e);
    res.status(500).json({ error: 'PayPal error' });
  }
});

// PayPal capture endpoint called by client after approval
app.post('/api/paypal/capture', async (req, res) => {
  const { paypalOrderId } = req.body;
  try {
    const request = new paypal.orders.OrdersCaptureRequest(paypalOrderId);
    request.requestBody({});
    const client = paypalClient();
    const capture = await client.execute(request);
    const customId = capture.result.purchase_units?.[0]?.custom_id;
    if (customId) {
      const order = await Order.findById(customId).populate('product');
      if (order && !order.paid) {
        order.paid = true;
        order.provider_payment_id = paypalOrderId;
        order.download_token = uuidv4();
        order.download_token_expires = new Date(Date.now() + 1000 * 60 * 60);
        await order.save();
      }
    }
    res.json({ ok: true });
  } catch (e) {
    console.error('PayPal capture error', e);
    res.status(500).json({ error: 'Capture failed' });
  }
});

// Cash App manual flow: create an order (provider: cashapp) and show instructions
app.post('/api/cashapp/create-order', async (req, res) => {
  const { productId, email } = req.body;
  const product = await Product.findById(productId);
  if (!product) return res.status(404).json({ error: 'Product not found' });
  const order = new Order({ product: product._id, amount_cents: product.price_cents, provider: 'cashapp', email });
  await order.save();
  // Client should display Cash App $Cashtag/QR and ask user to include order ID in note.
  res.json({ orderId: order._id, cashtag: process.env.CASHAPP_CASHTAG || '$YourCashtag' });
});

// Admin confirms cash app payment
app.post('/api/admin/confirm-cashapp', authMiddleware, requireAdmin, async (req, res) => {
  const { orderId } = req.body;
  const order = await Order.findById(orderId).populate('product');
  if (!order) return res.status(404).json({ error: 'Order not found' });
  order.paid = true;
  order.provider_payment_id = 'cashapp-manual-' + uuidv4();
  order.download_token = uuidv4();
  order.download_token_expires = new Date(Date.now() + 1000 * 60 * 60);
  await order.save();
  res.json({ ok: true });
});

// Download link endpoint (single-use)
app.get('/api/download/:token', async (req, res) => {
  const token = req.params.token;
  const order = await Order.findOne({ download_token: token }).populate('product');
  if (!order || !order.paid) return res.status(404).json({ error: 'Invalid token' });
  if (order.download_token_expires < new Date()) return res.status(410).json({ error: 'Token expired' });

  if (process.env.S3_BUCKET && order.product.file_key) {
    const params = { Bucket: process.env.S3_BUCKET, Key: order.product.file_key, Expires: 60 * 5 };
    const url = await s3.getSignedUrlPromise('getObject', params);
    order.download_token = null;
    await order.save();
    return res.json({ url });
  }

  const filePath = path.join(__dirname, 'files', order.product.file_key || '');
  if (fs.existsSync(filePath)) {
    order.download_token = null;
    await order.save();
    return res.download(filePath, `${order.product.name}.zip`);
  }

  res.status(500).json({ error: 'File not available' });
});

// Support tickets
app.post('/api/support/ticket', async (req, res) => {
  const { email, subject, message } = req.body;
  const ticket = new Ticket({ email, subject, message, replies: [] });
  await ticket.save();
  res.json({ ok: true, ticketId: ticket._id });
});
app.get('/api/support/tickets', authMiddleware, requireAdmin, async (req, res) => {
  const tickets = await Ticket.find().sort({ createdAt: -1 }).limit(500);
  res.json(tickets);
});
app.post('/api/support/tickets/:id/reply', authMiddleware, requireAdmin, async (req, res) => {
  const { message } = req.body;
  const t = await Ticket.findById(req.params.id);
  if (!t) return res.status(404).json({ error: 'Not found' });
  t.replies.push({ message, createdAt: new Date() });
  t.status = 'responded';
  await t.save();
  res.json({ ok: true });
});

// Admin: list orders (admin or owner)
app.get('/api/admin/orders', authMiddleware, requireAdmin, async (req, res) => {
  const orders = await Order.find().populate('product').sort({ createdAt: -1 }).limit(500);
  res.json(orders);
});

// Owner-only user management
app.get('/api/admin/users', authMiddleware, requireOwner, async (req, res) => {
  const users = await User.find().select('_id email role createdAt wallet_cents').sort({ createdAt: -1 });
  res.json(users);
});
app.post('/api/admin/assign-admin', authMiddleware, requireOwner, async (req, res) => {
  const { userId } = req.body;
  const user = await User.findById(userId);
  if (!user) return res.status(404).json({ error: 'User not found' });
  if (user.role === 'owner') return res.status(400).json({ error: 'Cannot change owner role' });
  user.role = 'admin';
  await user.save();
  res.json({ ok: true, user: { id: user._id, email: user.email, role: user.role } });
});
app.post('/api/admin/revoke-admin', authMiddleware, requireOwner, async (req, res) => {
  const { userId } = req.body;
  const user = await User.findById(userId);
  if (!user) return res.status(404).json({ error: 'User not found' });
  if (user.role === 'owner') return res.status(400).json({ error: 'Cannot change owner role' });
  user.role = 'user';
  await user.save();
  res.json({ ok: true, user: { id: user._id, email: user.email, role: user.role } });
});

app.listen(PORT, () => console.log(`Server running on ${PORT}`));
