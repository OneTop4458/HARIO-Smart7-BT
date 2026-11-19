import assert from 'node:assert/strict';
import { test } from 'node:test';
import { automaticRecipe, parseRecipeFile, validateRecipe } from '../public/recipes.js';
import { brewPoints } from '../public/brew-graph.js';

const fixture = {
  name: 'Synthetic recipe', temperature: 91, grounds: 19,
  steps: [{ volume: 40, pour: 6, wait: 25 }, { volume: 230, pour: 40, wait: 0 }],
  source: { label: 'Example', url: 'https://example.com/recipe' }
};

test('single files and old version-1 backups preserve the recipe', () => {
  const recipe = fixture;
  assert.deepEqual(parseRecipeFile(JSON.stringify(recipe)), [recipe]);
  assert.deepEqual(parseRecipeFile(JSON.stringify([recipe])), [recipe]);
  const legacyBackup = automaticRecipe(2, 'normal', 93);
  assert.deepEqual(parseRecipeFile(`\uFEFF${JSON.stringify({ version: 1, recipes: [{ id: 'old-id', ...legacyBackup }, recipe] })}`), [legacyBackup, recipe]);
});

test('legacy HARIO records use water, time and interval in transmitted order', () => {
  const record = {
    recipe_id: '999', user_name: 'Fixture', temperature: '91', coffee_grounds: '19', water: '270',
    detail: [{ water: '40', time: '6', interval: '25' }, { water: 230, time: 40, interval: 0 }, { water: 0, time: 0, interval: 0 }]
  };
  for (const input of [record, { status_code: true, data: [record] }]) {
    const [converted] = parseRecipeFile(JSON.stringify(input));
    assert.equal(converted.name, 'Fixture');
    assert.equal(converted.grounds, 19);
    assert.deepEqual(converted.steps, fixture.steps);
    assert.equal(converted.source.url, 'https://smart7.jp/detail_kr.php?recipe_no=999');
  }
  assert.throws(() => parseRecipeFile(JSON.stringify({ ...record, water: 700 })), /합계/);
  assert.throws(() => parseRecipeFile(JSON.stringify({ ...record, detail: [...record.detail, { water: 0, time: 0, interval: 2 }] })), /물량/);
});

test('malformed recipes and unsafe attribution links are rejected', () => {
  assert.throws(() => parseRecipeFile('no JSON'), /올바른 JSON/);
  assert.throws(() => parseRecipeFile('{"version":1,"recipes":[]}'), /JSON 파일/);
  const recipe = fixture;
  assert.throws(() => parseRecipeFile(JSON.stringify([recipe, { ...recipe, temperature: 99 }])), /2번째 레시피/);
  assert.throws(() => validateRecipe({ ...recipe, source: { label: 'recipe', url: 'javascript:alert(1)' } }), /HTTPS 주소/);
});

test('graph steps rise during pouring and stay flat during waits', () => {
  const points = brewPoints([{ volume: 70, pour: 8, wait: 30 }, { volume: 200, pour: 40, wait: 10 }]);
  assert.deepEqual(points, [
    { seconds: 0, volume: 0 }, { seconds: 8, volume: 70 }, { seconds: 38, volume: 70 },
    { seconds: 78, volume: 270 }, { seconds: 88, volume: 270 }
  ]);
});
