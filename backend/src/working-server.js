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

// SAP Data Import endpoint
app.post('/api/sap/import', async (req, res) => {
  try {
    const { data, importDate } = req.body;
    
    // Create import record
    const importResult = await pool.query(
      `INSERT INTO sap_data_imports (import_date, status, total_records) 
       VALUES ($1, 'processing', $2) 
       RETURNING id`,
      [importDate || new Date().toISOString().split('T')[0], data.length]
    );
    
    const importId = importResult.rows[0].id;
    
    // Insert raw data
    for (let i = 0; i < data.length; i++) {
      await pool.query(
        `INSERT INTO sap_raw_data (import_id, row_number, data) 
         VALUES ($1, $2, $3)`,
        [importId, i + 1, JSON.stringify(data[i])]
      );
    }
    
    // Update import status
    await pool.query(
      `UPDATE sap_data_imports SET status = 'completed', processed_records = $1 
       WHERE id = $2`,
      [data.length, importId]
    );
    
    console.log(`SAP data import completed: ${importId}`);
    
    res.status(201).json({
      success: true,
      data: {
        importId,
        totalRecords: data.length,
        message: 'SAP data imported successfully'
      }
    });
  } catch (error) {
    console.error('SAP data import failed:', error);
    res.status(500).json({
      success: false,
      error: { message: 'Failed to import SAP data' }
    });
  }
});

// Get SAP import history
app.get('/api/sap/imports', async (req, res) => {
  try {
    const { page = 1, limit = 10, status } = req.query;
    const offset = (Number(page) - 1) * Number(limit);
    
    let query = `
      SELECT id, import_date, import_timestamp, status, total_records, 
             processed_records, failed_records, created_at
      FROM sap_data_imports
    `;
    const params = [];
    
    if (status) {
      query += ` WHERE status = $1`;
      params.push(status);
    }
    
    query += ` ORDER BY import_timestamp DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    params.push(Number(limit), offset);
    
    const result = await pool.query(query, params);
    
    res.json({
      success: true,
      data: {
        imports: result.rows,
        pagination: {
          page: Number(page),
          limit: Number(limit),
          total: result.rows.length
        }
      }
    });
  } catch (error) {
    console.error('Failed to get import history:', error);
    res.status(500).json({
      success: false,
      error: { message: 'Failed to get import history' }
    });
  }
});

// Get SAP field mappings
app.get('/api/sap/field-mappings', async (req, res) => {
  try {
    const { userRole } = req.query;
    
    let query = `SELECT * FROM sap_field_mappings`;
    const params = [];
    
    if (userRole) {
      query += ` WHERE user_role = $1`;
      params.push(userRole);
    }
    
    query += ` ORDER BY sort_order, field_name`;
    
    const result = await pool.query(query, params);
    
    res.json({
      success: true,
      data: result.rows
    });
  } catch (error) {
    console.error('Failed to get field mappings:', error);
    res.status(500).json({
      success: false,
      error: { message: 'Failed to get field mappings' }
    });
  }
});

// Get SAP dashboard data
app.get('/api/sap/dashboard', async (req, res) => {
  try {
    // Get import statistics
    const importStats = await pool.query(`
      SELECT 
        COUNT(*) as total_imports,
        COUNT(CASE WHEN status = 'completed' THEN 1 END) as successful_imports,
        COUNT(CASE WHEN status = 'failed' THEN 1 END) as failed_imports,
        SUM(total_records) as total_records,
        SUM(processed_records) as processed_records
      FROM sap_data_imports
      WHERE import_date >= CURRENT_DATE - INTERVAL '30 days'
    `);
    
    // Get recent imports
    const recentImports = await pool.query(`
      SELECT id, import_date, status, total_records, import_timestamp
      FROM sap_data_imports
      ORDER BY import_timestamp DESC
      LIMIT 5
    `);
    
    res.json({
      success: true,
      data: {
        importStats: importStats.rows[0],
        recentImports: recentImports.rows
      }
    });
  } catch (error) {
    console.error('Failed to get SAP dashboard:', error);
    res.status(500).json({
      success: false,
      error: { message: 'Failed to get SAP dashboard' }
    });
  }
});

// Simple login endpoint
app.post('/api/auth/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    
    // Find user in database
    const result = await pool.query(
      'SELECT * FROM users WHERE username = $1',
      [username]
    );
    
    if (result.rows.length === 0) {
      return res.status(401).json({
        success: false,
        error: { message: 'Invalid credentials' }
      });
    }
    
    const user = result.rows[0];
    
    // Check password
    const isValidPassword = await bcrypt.compare(password, user.password_hash);
    
    if (!isValidPassword) {
      return res.status(401).json({
        success: false,
        error: { message: 'Invalid credentials' }
      });
    }
    
    // Generate JWT token
    const token = jwt.sign(
      { 
        id: user.id, 
        username: user.username, 
        email: user.email, 
        role: user.role 
      },
      process.env.JWT_SECRET || 'fallback-secret',
      { expiresIn: '7d' }
    );
    
    res.json({
      success: true,
      data: {
        token,
        user: {
          id: user.id,
          username: user.username,
          email: user.email,
          role: user.role
        }
      }
    });
    
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({
      success: false,
      error: { message: 'Internal server error' }
    });
  }
});

// Dashboard data endpoint
app.get('/api/dashboard', async (req, res) => {
  try {
    // Get basic stats
    const contractsResult = await pool.query('SELECT COUNT(*) as count FROM contracts');
    const shipmentsResult = await pool.query('SELECT COUNT(*) as count FROM shipments');
    const paymentsResult = await pool.query('SELECT COUNT(*) as count FROM payments');
    
    res.json({
      success: true,
      data: {
        contracts: { total: parseInt(contractsResult.rows[0].count) },
        shipments: { total: parseInt(shipmentsResult.rows[0].count) },
        payments: { total: parseInt(paymentsResult.rows[0].count) }
      }
    });
  } catch (error) {
    console.error('Dashboard error:', error);
    res.status(500).json({
      success: false,
      error: { message: 'Internal server error' }
    });
  }
});

// Start server
app.listen(PORT, () => {
  console.log(`🚀 KLIP Backend Server running on http://localhost:${PORT}`);
  console.log(`📊 Health check: http://localhost:${PORT}/health`);
  console.log(`🔐 Login endpoint: http://localhost:${PORT}/api/auth/login`);
  console.log(`📈 Dashboard endpoint: http://localhost:${PORT}/api/dashboard`);
});
