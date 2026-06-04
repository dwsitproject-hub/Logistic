import bcrypt from 'bcryptjs';
import pool from './connection';
import logger from '../utils/logger';

const seed = async () => {
  try {
    logger.info('Starting database seeding...');

    // Create admin user
    const adminPassword = await bcrypt.hash('admin123', 10);
    await pool.query(
      `INSERT INTO users (username, email, password_hash, full_name, role)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (username) DO NOTHING`,
      ['admin', 'admin@klip.com', adminPassword, 'System Administrator', 'ADMIN']
    );

    // Create trading user
    const tradingPassword = await bcrypt.hash('trading123', 10);
    await pool.query(
      `INSERT INTO users (username, email, password_hash, full_name, role)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (username) DO NOTHING`,
      ['trading', 'trading@klip.com', tradingPassword, 'Trading User', 'TRADING']
    );

    // Create logistics user
    const logisticsPassword = await bcrypt.hash('logistics123', 10);
    await pool.query(
      `INSERT INTO users (username, email, password_hash, full_name, role)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (username) DO NOTHING`,
      ['logistics', 'logistics@klip.com', logisticsPassword, 'Logistics User', 'LOGISTICS']
    );

    // Create finance user
    const financePassword = await bcrypt.hash('finance123', 10);
    await pool.query(
      `INSERT INTO users (username, email, password_hash, full_name, role)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (username) DO NOTHING`,
      ['finance', 'finance@klip.com', financePassword, 'Finance User', 'FINANCE']
    );

    // Create management user
    const managementPassword = await bcrypt.hash('management123', 10);
    await pool.query(
      `INSERT INTO users (username, email, password_hash, full_name, role)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (username) DO NOTHING`,
      ['management', 'management@klip.com', managementPassword, 'Management User', 'MANAGEMENT']
    );

    logger.info('Database seeding completed successfully!');
    logger.info('Default users created:');
    logger.info('  - admin/admin123 (ADMIN)');
    logger.info('  - trading/trading123 (TRADING)');
    logger.info('  - logistics/logistics123 (LOGISTICS)');
    logger.info('  - finance/finance123 (FINANCE)');
    logger.info('  - management/management123 (MANAGEMENT)');

    process.exit(0);
  } catch (error) {
    logger.error('Database seeding failed:', error);
    process.exit(1);
  }
};

seed();

