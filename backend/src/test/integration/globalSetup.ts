import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import { spawnSync } from 'child_process';

export default async function globalSetup() {
  const backendRoot = path.join(__dirname, '../../..');
  const envTest = path.join(backendRoot, 'env.test');
  if (fs.existsSync(envTest)) dotenv.config({ path: envTest });

  const env = {
    ...process.env,
    NODE_ENV: 'test',
    DB_HOST: process.env.DB_HOST || 'localhost',
    DB_PORT: process.env.DB_PORT || '5434',
    DB_NAME: process.env.DB_NAME || 'klip_test',
    DB_USER: process.env.DB_USER || 'postgres',
    DB_PASSWORD: process.env.DB_PASSWORD || 'postgres',
  };

  const cmd = process.platform === 'win32' ? 'npx.cmd' : 'npx';
  const sh = process.platform === 'win32';
  const migrate = spawnSync(cmd, ['ts-node', 'src/database/migrate.ts'], { cwd: backendRoot, env, encoding: 'utf-8', shell: sh });
  if (migrate.status !== 0) {
    throw new Error(`migrate failed: ${migrate.stderr || migrate.stdout}`);
  }
  const seed = spawnSync(cmd, ['ts-node', 'src/database/seed.ts'], { cwd: backendRoot, env, encoding: 'utf-8', shell: sh });
  if (seed.status !== 0) {
    throw new Error(`seed failed: ${seed.stderr || seed.stdout}`);
  }
}
