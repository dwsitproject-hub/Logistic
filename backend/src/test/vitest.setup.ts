process.env.NODE_ENV = 'test';
if (!process.env.JWT_SECRET) {
  process.env.JWT_SECRET = 'vitest-jwt-secret-key-minimum-32-characters-long';
}
