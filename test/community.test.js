import assert from 'node:assert/strict';
import test from 'node:test';
import { getCommunityIssue, isCommunityIssue, issueRecipe, listCommunityIssues, recipeProposalUrl } from '../public/community-recipes.js';
import { automaticRecipe } from '../public/recipes.js';

test('the board accepts open recipe issues and hides closed issues and pull requests', () => {
  const issue = { state: 'open', title: '[레시피] 2잔', labels: [], number: 12 };
  assert.equal(isCommunityIssue(issue), true);
  assert.equal(isCommunityIssue({ ...issue, state: 'closed' }), false);
  assert.equal(isCommunityIssue({ ...issue, pull_request: {} }), false);
  assert.equal(isCommunityIssue({ ...issue, title: 'General issue' }), false);
  assert.equal(isCommunityIssue({ ...issue, title: 'Manual post', labels: [{ name: 'recipe' }] }), true);
});

test('a composed issue carries importable brew settings and retains attribution', () => {
  const draft = {
    ...automaticRecipe(2, 'normal', 93),
    name: '아침',
    photo: 'data:image/jpeg;base64,/9j/AA==',
    source: { label: 'Recipe source', url: 'https://example.org/recipe' }
  };
  const link = new URL(recipeProposalUrl(draft, { beans: '블렌드', grind: '중간', description: '중간 분쇄로 추출' }));
  assert.equal(link.hostname, 'github.com');
  assert.equal(link.searchParams.get('template'), 'recipe.md');
  assert.equal(link.searchParams.get('title'), '[레시피] 아침');
  const body = link.searchParams.get('body');
  assert.equal(body.includes('data:image'), false);
  const attachment = issueRecipe({ number: 42, body: body.replaceAll('\n', '\r\n') });
  assert.deepEqual(attachment.recipe.steps, draft.steps);
  assert.deepEqual(attachment.details, {
    beans: '블렌드', grind: '중간', description: '중간 분쇄로 추출', source: 'https://example.org/recipe'
  });
  assert.match(attachment.recipe.source.url, /\/issues\/42$/);
  assert.match(attachment.body, /example\.org\/recipe/);
  assert.equal(issueRecipe({ number: 42, body: body.replace('"temperature":93', '"temperature":100') }), null);
  assert.equal(issueRecipe({ number: 42, body: 'A question without a recipe' }), null);
});

test('archival attribution is accepted only on moderation-labeled issues', () => {
  const draft = {
    ...automaticRecipe(2, 'normal', 93),
    source: { label: 'Original recipe', url: 'https://example.org/archive' },
    archive: { id: 999, grind: '중간', photo: 'cup' }
  };
  const body = '\x60\x60\x60json\n' + JSON.stringify(draft) + '\n\x60\x60\x60';
  const issue = { number: 42, body, labels: [{ name: 'recipe' }] };
  assert.equal(issueRecipe(issue).archive, undefined);
  const archived = issueRecipe({ ...issue, labels: [{ name: 'recipe-archive' }] });
  assert.deepEqual(archived.archive, { ...draft.archive, guide: '' });
  assert.deepEqual(archived.recipe.source, draft.source);
});

test('the issue list follows pagination and excludes closed topics from direct links', async context => {
  const next = 'https://api.github.com/repositories/1/issues?page=2';
  const issue = { state: 'open', title: '[레시피] Fixture', labels: [], number: 12 };
  const fetch = context.mock.method(globalThis, 'fetch', async url => {
    if (url === next) return Response.json([{ ...issue, number: 14 }]);
    if (url.endsWith('/13')) return Response.json({ ...issue, number: 13, state: 'closed' });
    return Response.json([issue, { ...issue, pull_request: {} }], { headers: { link: `<${next}>; rel="next"` } });
  });
  assert.deepEqual((await listCommunityIssues()).map(item => item.number), [12, 14]);
  assert.equal(await getCommunityIssue(13), null);
  assert.equal(fetch.mock.callCount(), 3);
});
