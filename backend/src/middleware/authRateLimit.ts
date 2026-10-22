import { rateLimit } from 'express-rate-limit';

/**
 * Limits on the public password-link endpoints, per client IP (the app sits behind a proxy: `configureTrustProxy` makes `req.ip` the real
 * client). In-memory, which is right for the single backend container; with more than one instance the counters would need a shared store.
 */
function limiter(limit: number, windowMinutes: number, message: string) {
  return rateLimit({
    windowMs: windowMinutes * 60 * 1000,
    limit,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: { success: false, error: { message } },
  });
}

/** "Forgot password" sends e-mail, so it is the tightest. */
export const forgotPasswordLimiter = limiter(5, 15, 'Too many requests. Please try again in a few minutes.');

/** Checking or spending a link. */
export const passwordLinkLimiter = limiter(30, 15, 'Too many attempts. Please try again in a few minutes.');
