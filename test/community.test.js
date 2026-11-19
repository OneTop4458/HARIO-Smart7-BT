import assert from 'node:assert/strict';
import test from 'node:test';
import { isCommunityIssue, issueRecipe, recipeProposalUrl } from '../public/community-recipes.js';
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
    photo: 'data:image/jpeg;base64,/9j/AA==',
    source: { label: 'Recipe source', url: 'https://example.org/recipe' }
  };
  const link = new URL(recipeProposalUrl('아침', '중간 분쇄로 추출', draft));
  assert.equal(link.hostname, 'github.com');
  assert.equal(link.searchParams.get('template'), 'recipe.md');
  assert.equal(link.searchParams.get('title'), '[레시피] 아침');
  const body = link.searchParams.get('body');
  assert.equal(body.includes('data:image'), false);
  const attachment = issueRecipe({ number: 42, body: body.replaceAll('\n', '\r\n') });
  assert.deepEqual(attachment.recipe.steps, draft.steps);
  assert.match(attachment.recipe.source.url, /\/issues\/42$/);
  assert.match(attachment.body, /example\.org\/recipe$/);
  assert.equal(issueRecipe({ number: 42, body: body.replace('"temperature":93', '"temperature":100') }), null);
  assert.equal(issueRecipe({ number: 42, body: 'A question without a recipe' }), null);
});
