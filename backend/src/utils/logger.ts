import winston from 'winston';
import fs from 'fs';

const isProduction = process.env.NODE_ENV === 'production';

// Console first so Docker/PM2 always see output (File may fail on mounted volumes)
const transports: winston.transport[] = [
  new winston.transports.Console({
    format: winston.format.combine(
      isProduction ? winston.format.uncolorize() : winston.format.colorize(),
      winston.format.simple()
    ),
  }),
];

// Add file transports only if logs dir is writable (avoid crash in Docker when volume has wrong perms)
try {
  const logDir = 'logs';
  if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });
  transports.push(new winston.transports.File({ filename: `${logDir}/error.log`, level: 'error' }));
  transports.push(new winston.transports.File({ filename: `${logDir}/combined.log` }));
} catch {
  // ignore; console logging only
}

const logger = winston.createLogger({
  level: isProduction ? 'info' : 'debug',
  format: winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    winston.format.errors({ stack: true }),
    winston.format.splat(),
    winston.format.json()
  ),
  defaultMeta: { service: 'klip-backend' },
  transports,
});

export default logger;

