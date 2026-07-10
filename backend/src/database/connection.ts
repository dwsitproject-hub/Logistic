import { Pool, PoolClient, QueryResult } from 'pg';
import dotenv from 'dotenv';
import logger from '../utils/logger';

dotenv.config();

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432'),
  database: process.env.DB_NAME || 'klip_db',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
  // Disable PostgreSQL JIT compilation for this app's connections. The generated
  // list/report queries contain hundreds of expressions, which trips the JIT cost
  // thresholds and makes Postgres spend most of the query time LLVM-compiling them
  // on EVERY execution (measured: trucking list 11.7s -> 2.3s with jit off; JIT was
  // ~9.7s of it). JIT only changes how the executor evaluates expressions, never
  // query results or plans, so this is a pure latency win for our workload.
  options: '-c jit=off',
});

pool.on('connect', () => {
  logger.info('Database connected successfully');
});

pool.on('error', (err) => {
  logger.error('Unexpected error on idle client', err);
  process.exit(-1);
});

export const query = async (text: string, params?: any[]): Promise<QueryResult> => {
  const start = Date.now();
  try {
    const res = await pool.query(text, params);
    const duration = Date.now() - start;
    logger.debug('Executed query', { text, duration, rows: res.rowCount });
    return res;
  } catch (error) {
    logger.error('Query error', { text, error });
    throw error;
  }
};

export const getClient = async (): Promise<PoolClient> => {
  const client = await pool.connect();
  return client;
};

export default pool;

