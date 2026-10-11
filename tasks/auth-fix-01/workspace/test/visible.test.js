import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAuth } from '../src/auth.js';

test('a registered user can log in with the same password', () => {
  const auth = createAuth();
  auth.register('ada@example.com', 'correct horse');
  const { token } = auth.login('ada@example.com', 'correct horse');
  assert.equal(typeof token, 'string');
});

test('a fresh session token verifies', () => {
  const auth = createAuth();
  auth.register('ada@example.com', 'correct horse');
  const { token } = auth.login('ada@example.com', 'correct horse');
  assert.deepEqual(auth.verify(token), { email: 'ada@example.com' });
});

test('wrong password is rejected', () => {
  const auth = createAuth();
  auth.register('ada@example.com', 'correct horse');
  assert.throws(() => auth.login('ada@example.com', 'wrong horse'), { code: 'INVALID_CREDENTIALS' });
});
