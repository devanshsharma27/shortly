// Run against an empty development stack: node scripts/smoke.mjs
import assert from 'node:assert/strict';
const base = process.env.TEST_URL || 'http://localhost:8080';
const email = `smoke-${Date.now()}@example.com`;
const password = 'Smoke-test-password-42';
async function call(path, { token, method = 'GET', body, status = 200 } = {}) {
  const response = await fetch(base + path, { method, redirect: 'manual', headers: { 'Content-Type': 'application/json', ...(token && { Authorization: `Bearer ${token}` }) }, ...(body && { body: JSON.stringify(body) }) });
  assert.equal(response.status, status, `${method} ${path}: ${await response.clone().text()}`);
  return response;
}
const instances = new Set();
for (let i = 0; i < 8; i++) instances.add((await (await call('/api/health')).json()).instance);
if (process.env.EXPECT_TWO_INSTANCES === '1') assert.equal(instances.size, 2, 'Both backend instances should receive traffic');
await call('/api/ready');
await call('/api/urls', { status: 401 });
await call('/api/auth/register', { method: 'POST', body: { email, password }, status: 201 });
await call('/api/auth/register', { method: 'POST', body: { email, password }, status: 409 });
const session = await (await call('/api/auth/login', { method: 'POST', body: { email, password } })).json();
const token = session.accessToken;
for (const longUrl of ['javascript:alert(1)', 'data:text/html,hello', 123, 'https://user:pass@example.com']) {
  await call('/api/urls', { token, method: 'POST', body: { longUrl }, status: 400 });
}
const row = await (await call('/api/urls', { token, method: 'POST', body: { longUrl: 'https://example.com/original' }, status: 201 })).json();
assert.match(row.shortCode, /^[a-zA-Z0-9]{7}$/);
assert.equal(new URL(row.shortUrl).pathname, '/' + row.shortCode);
for (let i = 0; i < 2; i++) {
  const response = await call('/' + row.shortCode, { status: 302 });
  assert.equal(response.headers.get('location'), 'https://example.com/original');
  assert.equal(response.headers.get('cache-control'), 'no-store');
}
const list = await (await call('/api/urls?search=original', { token })).json();
assert.equal(list.pagination.total, 1);
assert.equal(list.data[0].shortUrl, row.shortUrl);
await call('/api/urls/' + row.id, { token, method: 'PATCH', body: { longUrl: 'https://example.org/changed' } });
assert.equal((await call('/' + row.shortCode, { status: 302 })).headers.get('location'), 'https://example.org/changed');
await call('/api/auth/register', { method: 'POST', body: { email: 'other-' + email, password }, status: 201 });
const other = await (await call('/api/auth/login', { method: 'POST', body: { email: 'other-' + email, password } })).json();
await call('/api/urls/' + row.id, { token: other.accessToken, method: 'DELETE', status: 403 });
await call('/api/urls/' + row.id, { token, method: 'DELETE', status: 204 });
await call('/' + row.shortCode, { status: 404 });
// Exactly one concurrent refresh can consume the old token, regardless of instance.
const refresh = () => fetch(base + '/api/auth/refresh', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ refreshToken: session.refreshToken }) });
const rotated = await Promise.all([refresh(), refresh()]);
assert.deepEqual(rotated.map(r => r.status).sort(), [200, 401]);
const fresh = await rotated.find(r => r.status === 200).json();
await call('/api/auth/logout', { method: 'POST', body: { refreshToken: fresh.refreshToken }, status: 204 });
await call('/api/auth/refresh', { method: 'POST', body: { refreshToken: fresh.refreshToken }, status: 401 });
// Five auth requests above share one IP across two instances: sixth must be limited.
await call('/api/auth/login', { method: 'POST', body: { email, password }, status: 429 });
console.log('PASS: health, balancing, auth, validation, CRUD, ownership, redirects, refresh race, logout, shared rate limit');
