// Reference solution for auth-fix-01. Used only to validate the harness and hidden suite.

import { scryptSync, randomBytes, timingSafeEqual } from 'node:crypto';

const SESSION_TTL_MS = 60 * 60 * 1000; // 1 hour
const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_WINDOW_MS = 15 * 60 * 1000; // 15 minutes

export class AuthError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

function hashPassword(password, salt) {
  return scryptSync(password, salt, 32).toString('hex');
}

const normalize = (email) => String(email ?? '').trim().toLowerCase();

export function createAuth({ store = new Map(), sessions = new Map(), now = () => Date.now() } = {}) {
  const failures = new Map(); // email -> [timestamps]

  function register(rawEmail, password) {
    const email = normalize(rawEmail);
    if (!email || !email.includes('@')) throw new AuthError('INVALID_EMAIL', 'A valid email is required');
    if (!password || password.length < 8) throw new AuthError('WEAK_PASSWORD', 'Password must be at least 8 characters');
    if (store.has(email)) throw new AuthError('EMAIL_TAKEN', 'An account with this email already exists');
    const salt = randomBytes(16).toString('hex');
    store.set(email, { email, salt, hash: hashPassword(password, salt), createdAt: now() });
    return { email };
  }

  function login(rawEmail, password) {
    const email = normalize(rawEmail);
    const user = store.get(email);
    const recent = (failures.get(email) || []).filter((t) => now() - t < LOCKOUT_WINDOW_MS);
    if (recent.length >= MAX_FAILED_ATTEMPTS) {
      failures.set(email, recent);
      throw new AuthError('LOCKED', 'Too many failed attempts, try again later');
    }
    const ok = user && timingSafeEqual(Buffer.from(hashPassword(String(password ?? ''), user.salt), 'hex'), Buffer.from(user.hash, 'hex'));
    if (!ok) {
      recent.push(now());
      failures.set(email, recent);
      throw new AuthError('INVALID_CREDENTIALS', 'Email or password is incorrect');
    }
    failures.delete(email);
    const token = randomBytes(24).toString('hex');
    sessions.set(token, { email: user.email, expiresAt: now() + SESSION_TTL_MS });
    return { token };
  }

  function verify(token) {
    const session = sessions.get(token);
    if (!session) return null;
    if (session.expiresAt < now()) {
      sessions.delete(token);
      return null;
    }
    return { email: session.email };
  }

  function logout(token) {
    sessions.delete(token);
    return true;
  }

  return { register, login, verify, logout };
}
