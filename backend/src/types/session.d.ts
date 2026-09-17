import 'express-session';

declare module 'express-session' {
  interface SessionData {
    userId?: string;
    oidcState?: string;
    oidcNonce?: string;
    oidcCodeVerifier?: string;
  }
}
