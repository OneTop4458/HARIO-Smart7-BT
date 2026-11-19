import assert from 'node:assert/strict';
import test from 'node:test';
import { getCommunityIssue, isCommunityIssue, issueImage, issueRecipe, issueTitle, listCommunityIssues, recipeProposalUrl } from '../public/community-recipes.js';
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
    beans: '블렌드',
    grind: '중간',
    photo: 'data:image/jpeg;base64,/9j/AA==',
    source: { label: 'Recipe source', url: 'https://example.org/recipe' }
  };
  const link = new URL(recipeProposalUrl(draft, {
    description: '중간 분쇄로 추출', language: 'ko',
    translations: { en: { title: 'Morning coffee', description: 'Brew with a medium grind' }, ja: { title: '朝のコーヒー' } }
  }));
  assert.equal(link.hostname, 'github.com');
  assert.equal(link.searchParams.get('template'), 'recipe.md');
  assert.equal(link.searchParams.get('title'), '[레시피] 아침');
  const body = link.searchParams.get('body');
  assert.match(body, /## 사진 \/ Photo/);
  assert.equal(body.includes('data:image'), false);
  const attachment = issueRecipe({ number: 42, body: body.replaceAll('\n', '\r\n') });
  assert.deepEqual(attachment.recipe.steps, draft.steps);
  assert.equal(attachment.recipe.beans, draft.beans);
  assert.equal(attachment.recipe.grind, draft.grind);
  assert.equal(attachment.language, 'ko');
  assert.equal(attachment.translations.en.description, 'Brew with a medium grind');
  assert.equal(issueTitle({ title: '[레시피] 아침' }, attachment, 'en'), 'Morning coffee');
  assert.equal(issueTitle({ title: '[레시피] 아침' }, attachment, 'ja'), '朝のコーヒー');
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
    archive: { id: 999, grind: '중간', photo: 'cup', titles: { en: 'Archived recipe', ja: '保存レシピ' } }
  };
  const body = '\x60\x60\x60json\n' + JSON.stringify(draft) + '\n\x60\x60\x60';
  const issue = { title: '[레시피] 원본 제목', number: 42, body, labels: [{ name: 'recipe' }] };
  assert.equal(issueRecipe(issue).archive, undefined);
  const archived = issueRecipe({ ...issue, labels: [{ name: 'recipe-archive' }] });
  assert.deepEqual(archived.archive, { ...draft.archive, guide: '' });
  assert.deepEqual(archived.recipe.source, draft.source);
  assert.equal(issueTitle(issue, archived, 'ko'), '원본 제목');
  assert.equal(issueTitle(issue, archived, 'en'), 'Archived recipe');
  assert.equal(issueTitle(issue, archived, 'ja'), '保存レシピ');
  assert.equal(issueTitle(issue, undefined, 'en'), '원본 제목');
});

test('public recipe covers accept GitHub attachments from markdown and HTML', () => {
  const attachment = 'https://github.com/user-attachments/assets/8bef88c1-40ba-413b-8444-d018c9691787';
  const legacy = 'https://user-images.githubusercontent.com/1234/old-photo.jpg';
  assert.equal(issueImage({ body: '![Photo](' + attachment + ')' }), attachment);
  assert.equal(issueImage({ body: '<img width="400" alt="Photo" src="' + legacy + '">' }), legacy);
  assert.equal(issueImage({ body: '![Photo](https://github.com.example.org/user-attachments/assets/a-b)' }), '');
  assert.equal(issueImage({ body: '![Photo](https://github.com/user-attachments/assets/payload.svg)' }), '');
});

test('the issue list follows pagination and excludes closed topics from direct links', async context => {
  const next = 'https://api.github.com/repositories/1/issues?page=2';
  const issue = { state: 'open', title: '[레시피] Fixture', labels: [], number: 12 };
  const fetch = context.mock.method(globalThis, 'fetch', async url => {
    if (url === next) return Response.json([{ ...issue, number: 14 }]);
    return Response.json([issue, { ...issue, number: 13, state: 'closed' }, { ...issue, pull_request: {} }], {
      headers: { link: `<${next}>; rel="next"` }
    });
  });
  assert.deepEqual((await listCommunityIssues()).map(item => item.number), [12, 14]);
  assert.equal(await getCommunityIssue(13), null);
  assert.ok(fetch.mock.calls.every(call => !call.arguments[0].endsWith('/13')));
});
