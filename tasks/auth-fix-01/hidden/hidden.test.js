// AgentRank hidden suite for task auth-fix-01. Never shown to the agent during a run.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAuth, AuthError } from '../src/auth.js';

const PW = 'correct horse';
function clock(start = 1_700_000_000_000) {
  let t = start;
  return { now: () => t, advance: (ms) => { t += ms; } };
}
function fresh(opts = {}) {
  const c = clock();
  const store = new Map();
  const auth = createAuth({ store, now: c.now, ...opts });
  return { auth, c, store };
}

test('H01 register then login with same password succeeds', () => {
  const { auth } = fresh();
  auth.register('ada@example.com', PW);
  assert.equal(typeof auth.login('ada@example.com', PW).token, 'string');
});

test('H02 login is case-insensitive and trims whitespace', () => {
  const { auth } = fresh();
  auth.register(' Sam@Example.com ', PW);
  assert.equal(typeof auth.login('sam@example.com', PW).token, 'string');
  assert.equal(typeof auth.login('SAM@EXAMPLE.COM', PW).token, 'string');
});

test('H03 verify returns the normalized email', () => {
  const { auth } = fresh();
  auth.register(' Sam@Example.com ', PW);
  const { token } = auth.login('sam@example.com', PW);
  assert.deepEqual(auth.verify(token), { email: 'sam@example.com' });
});

test('H04 session is valid immediately after login', () => {
  const { auth } = fresh();
  auth.register('ada@example.com', PW);
  const { token } = auth.login('ada@example.com', PW);
  assert.deepEqual(auth.verify(token), { email: 'ada@example.com' });
});

test('H05 session is still valid at 59 minutes', () => {
  const { auth, c } = fresh();
  auth.register('ada@example.com', PW);
  const { token } = auth.login('ada@example.com', PW);
  c.advance(59 * 60 * 1000);
  assert.deepEqual(auth.verify(token), { email: 'ada@example.com' });
});

test('H06 session expires after 1 hour', () => {
  const { auth, c } = fresh();
  auth.register('ada@example.com', PW);
  const { token } = auth.login('ada@example.com', PW);
  c.advance(60 * 60 * 1000 + 1);
  assert.equal(auth.verify(token), null);
});

test('H07 logout invalidates the token', () => {
  const { auth } = fresh();
  auth.register('ada@example.com', PW);
  const { token } = auth.login('ada@example.com', PW);
  auth.logout(token);
  assert.equal(auth.verify(token), null);
});

test('H08 logout leaves other sessions intact', () => {
  const { auth } = fresh();
  auth.register('ada@example.com', PW);
  const a = auth.login('ada@example.com', PW).token;
  const b = auth.login('ada@example.com', PW).token;
  auth.logout(a);
  assert.deepEqual(auth.verify(b), { email: 'ada@example.com' });
});

test('H09 duplicate registration throws EMAIL_TAKEN and keeps the original password', () => {
  const { auth } = fresh();
  auth.register('ada@example.com', PW);
  assert.throws(() => auth.register('ada@example.com', 'attacker pass'), (e) => e instanceof AuthError && e.code === 'EMAIL_TAKEN');
  assert.equal(typeof auth.login('ada@example.com', PW).token, 'string');
  assert.throws(() => auth.login('ada@example.com', 'attacker pass'), { code: 'INVALID_CREDENTIALS' });
});

test('H10 duplicate check is case-insensitive', () => {
  const { auth } = fresh();
  auth.register('ada@example.com', PW);
  assert.throws(() => auth.register(' ADA@example.com', 'attacker pass'), { code: 'EMAIL_TAKEN' });
});

test('H11 sixth attempt after 5 failures is LOCKED even with the right password', () => {
  const { auth } = fresh();
  auth.register('ada@example.com', PW);
  for (let i = 0; i < 5; i++) assert.throws(() => auth.login('ada@example.com', 'nope nope'), { code: 'INVALID_CREDENTIALS' });
  assert.throws(() => auth.login('ada@example.com', PW), { code: 'LOCKED' });
});

test('H12 four failures then the right password still works', () => {
  const { auth } = fresh();
  auth.register('ada@example.com', PW);
  for (let i = 0; i < 4; i++) assert.throws(() => auth.login('ada@example.com', 'nope nope'));
  assert.equal(typeof auth.login('ada@example.com', PW).token, 'string');
});

test('H13 lockout lifts after the 15 minute window', () => {
  const { auth, c } = fresh();
  auth.register('ada@example.com', PW);
  for (let i = 0; i < 5; i++) assert.throws(() => auth.login('ada@example.com', 'nope nope'));
  c.advance(15 * 60 * 1000 + 1);
  assert.equal(typeof auth.login('ada@example.com', PW).token, 'string');
});

test('H14 lockout counts across email casing', () => {
  const { auth } = fresh();
  auth.register('ada@example.com', PW);
  for (let i = 0; i < 5; i++) assert.throws(() => auth.login(i % 2 ? 'ADA@example.com' : 'ada@example.com', 'nope nope'));
  assert.throws(() => auth.login('ada@example.com', PW), { code: 'LOCKED' });
});

test('H15 lockout is per account', () => {
  const { auth } = fresh();
  auth.register('ada@example.com', PW);
  auth.register('bob@example.com', PW);
  for (let i = 0; i < 5; i++) assert.throws(() => auth.login('ada@example.com', 'nope nope'));
  assert.equal(typeof auth.login('bob@example.com', PW).token, 'string');
});

test('H16 unknown user gets INVALID_CREDENTIALS', () => {
  const { auth } = fresh();
  assert.throws(() => auth.login('ghost@example.com', PW), { code: 'INVALID_CREDENTIALS' });
});

test('H17 validation still rejects weak passwords and invalid emails', () => {
  const { auth } = fresh();
  assert.throws(() => auth.register('ada@example.com', 'short'), { code: 'WEAK_PASSWORD' });
  assert.throws(() => auth.register('not-an-email', PW), { code: 'INVALID_EMAIL' });
});

test('H18 passwords are not stored in plaintext', () => {
  const { auth, store } = fresh();
  auth.register('ada@example.com', PW);
  assert.ok(!JSON.stringify([...store.values()]).includes(PW));
});

test('H19 unknown token verifies to null', () => {
  const { auth } = fresh();
  assert.equal(auth.verify('deadbeef'), null);
});
