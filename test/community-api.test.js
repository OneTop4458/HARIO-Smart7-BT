import assert from 'node:assert/strict';
import test from 'node:test';
import community from '../api/community.js';

const request = (suffix = '', method = 'GET') => new Request('https://example.com/api/community' + suffix, { method });
const issue = { number: 20, state: 'open', title: '[레시피] Shared recipe', labels: [{ name: 'recipe' }] };

test('the public endpoint shares one upstream request and caches open recipes', async context => {
  const fetch = context.mock.method(globalThis, 'fetch', async url => {
    assert.equal(new URL(url).searchParams.get('state'), 'open');
    return Response.json([issue, { ...issue, number: 21, state: 'closed' }]);
  });
  const responses = await Promise.all([community.fetch(request()), community.fetch(request())]);
  for (const response of responses) {
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), [issue]);
    assert.match(response.headers.get('Vercel-CDN-Cache-Control'), /s-maxage=120/);
  }
  assert.equal(fetch.mock.callCount(), 1);
});

test('a GitHub rate-limit error can be retried and is not cached', async context => {
  context.mock.method(globalThis, 'fetch', async () => new Response(null, {
    status: 403, headers: { 'x-ratelimit-remaining': '0' }
  }));
  const response = await community.fetch(request());
  assert.equal(response.status, 429);
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
});

test('the community endpoint rejects writes and arbitrary queries', async () => {
  assert.equal((await community.fetch(request('', 'POST'))).status, 405);
  assert.equal((await community.fetch(request('?comments=../../issues'))).status, 400);
  assert.equal((await community.fetch(request('?other=1'))).status, 400);
});
