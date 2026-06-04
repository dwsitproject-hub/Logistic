const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { Pool } = require('pg');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 5001;

// Database connection
const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 5432,
  database: process.env.DB_NAME || 'klip_db',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'postgres',
});

// Middleware
app.use(cors());
app.use(express.json());

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'OK', message: 'KLIP Backend is running' });
});

// Simple login endpoint
app.post('/api/auth/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    
    // Find user in database
    const result = await pool.query(
      'SELECT * FROM users WHERE username = $1 AND is_active = true',
      [username]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({
        success: false,
        error: { message: 'Invalid credentials' },
      });
    }

    const user = result.rows[0];

    // Verify password
    const isPasswordValid = await bcrypt.compare(password, user.password_hash);

    if (!isPasswordValid) {
      return res.status(401).json({
        success: false,
        error: { message: 'Invalid credentials' },
      });
    }

    // Generate JWT token
    const token = jwt.sign(
      { id: user.id, username: user.username, email: user.email, role: user.role },
      process.env.JWT_SECRET || 'fallback-secret',
      { expiresIn: '7d' }
    );

    res.json({
      success: true,
      data: {
        user: {
          id: user.id,
          username: user.username,
          email: user.email,
          full_name: user.full_name,
          role: user.role,
          is_active: user.is_active,
        },
        token,
      },
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({
      success: false,
      error: { message: 'Failed to login' },
    });
  }
});

// Simple register endpoint
app.post('/api/auth/register', async (req, res) => {
  try {
    const { username, email, password, full_name, role } = req.body;

    // Check if user already exists
    const existingUser = await pool.query(
      'SELECT * FROM users WHERE username = $1 OR email = $2',
      [username, email]
    );

    if (existingUser.rows.length > 0) {
      return res.status(400).json({
        success: false,
        error: { message: 'Username or email already exists' },
      });
    }

    // Hash password
    const password_hash = await bcrypt.hash(password, 10);

    // Create user
    const result = await pool.query(
      `INSERT INTO users (username, email, password_hash, full_name, role)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, username, email, full_name, role, is_active, created_at`,
      [username, email, password_hash, full_name, role]
    );

    const user = result.rows[0];

    // Generate JWT token
    const token = jwt.sign(
      { id: user.id, username: user.username, email: user.email, role: user.role },
      process.env.JWT_SECRET || 'fallback-secret',
      { expiresIn: '7d' }
    );

    res.status(201).json({
      success: true,
      data: {
        user,
        token,
      },
    });
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({
      success: false,
      error: { message: 'Failed to register user' },
    });
  }
});

// Simple dashboard data endpoint
app.get('/api/dashboard', (req, res) => {
  res.json({
    success: true,
    data: {
      totalContracts: 25,
      activeShipments: 12,
      pendingPayments: 8,
      qualityScore: 94.5,
      recentActivity: [
        { id: 1, type: 'contract', message: 'New contract signed', timestamp: new Date().toISOString() },
        { id: 2, type: 'shipment', message: 'Shipment delivered', timestamp: new Date().toISOString() },
        { id: 3, type: 'payment', message: 'Payment received', timestamp: new Date().toISOString() },
      ]
    }
  });
});

// Simple contracts endpoint
app.get('/api/contracts', (req, res) => {
  res.json({
    success: true,
    data: [
      {
        id: '1',
        contract_number: 'CT-2024-001',
        supplier: 'ABC Logistics',
        start_date: '2024-01-01',
        end_date: '2024-12-31',
        status: 'Active',
        value: 150000
      },
      {
        id: '2',
        contract_number: 'CT-2024-002',
        supplier: 'XYZ Transport',
        start_date: '2024-02-01',
        end_date: '2024-11-30',
        status: 'Active',
        value: 200000
      }
    ]
  });
});

// Simple shipments endpoint
app.get('/api/shipments', (req, res) => {
  res.json({
    success: true,
    data: [
      {
        id: '1',
        shipment_number: 'SH-2024-001',
        origin: 'Jakarta',
        destination: 'Surabaya',
        status: 'In Transit',
        estimated_delivery: '2024-10-15'
      },
      {
        id: '2',
        shipment_number: 'SH-2024-002',
        origin: 'Bandung',
        destination: 'Medan',
        status: 'Delivered',
        estimated_delivery: '2024-10-10'
      }
    ]
  });
});

// Start server
app.listen(PORT, () => {
  console.log(`🚀 KLIP Backend running on http://localhost:${PORT}`);
  console.log(`📊 Health check: http://localhost:${PORT}/health`);
  console.log(`🔐 Login endpoint: http://localhost:${PORT}/api/auth/login`);
});
