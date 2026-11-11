import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import { signAccessToken, verifyAccessToken, renewAccessToken } from '../dist/auth.js';

// Self-contained checks: fixture secret, no live users and no database access.
process.env.JWT_SECRET ||= 'github-actions-test-secret-only-0123456789abcdefghijklmnop';
const now = Math.floor(Date.now() / 1000);
const options = {
  algorithm: 'HS256',
  subject: '6',
  issuer: 'mantenimiento-360',
  audience: 'mantenimiento-360-api',
};
const token = signAccessToken('6');
assert.equal(verifyAccessToken(token), '6');
const initial = jwt.decode(token);
assert.equal(initial.sessionStartedAt, initial.iat);
assert.ok(initial.exp - initial.iat <= 1800);
const newSession = renewAccessToken(token);
assert.equal(verifyAccessToken(newSession.token), '6');
assert.equal(jwt.decode(newSession.token).sessionStartedAt, initial.sessionStartedAt);
assert.ok(newSession.expiresIn <= 1800);

const oldFormat = jwt.sign({}, process.env.JWT_SECRET, { ...options, expiresIn: '30m' });
assert.equal(verifyAccessToken(renewAccessToken(oldFormat).token), '6');

const nearAbsoluteCap = jwt.sign({ sessionStartedAt: now - 4 * 3600 + 300 },
  process.env.JWT_SECRET, { ...options, expiresIn: '10m' });
const capRenewal = renewAccessToken(nearAbsoluteCap);
assert.ok(capRenewal.expiresIn <= 300);
assert.ok(jwt.decode(capRenewal.token).exp <= now + 300);

const tooOld = jwt.sign({ sessionStartedAt: now - 4 * 3600 - 1 },
  process.env.JWT_SECRET, { ...options, expiresIn: '10m' });
assert.throws(() => renewAccessToken(tooOld), /session_max_age/);
const expired = jwt.sign({}, process.env.JWT_SECRET, { ...options, expiresIn: -1 });
assert.throws(() => renewAccessToken(expired));
assert.throws(() => renewAccessToken(token.slice(0, -3) + 'bad'));
console.log('Session renewal smoke tests passed');
