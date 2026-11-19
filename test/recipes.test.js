import assert from 'node:assert/strict';
import { test } from 'node:test';
import { publicRecipes } from '../public/recipe-library.js';
import { automaticRecipe, parseRecipeFile, summarize, validateRecipe } from '../public/recipes.js';

test('public recipes match the published totals and fit the brew validator', () => {
  const expected = {
    1055: [300, 208], 1069: [410, 83], 1070: [410, 163], 1072: [330, 108],
    1071: [520, 108], 1065: [270, 93], 1197: [300, 137], 1228: [270, 135],
    1061: [300, 172], 1257: [270, 121], 1277: [300, 340], 1283: [310, 315], 1287: [270, 86],
    1321: [270, 145], 1323: [280, 195], 1330: [280, 164], 1334: [270, 103], 1633: [610, 168], 1715: [280, 150]
  };
  assert.equal(publicRecipes.length, Object.keys(expected).length);
  for (const recipe of publicRecipes) {
    assert.deepEqual(validateRecipe(recipe), recipe);
    const id = new URL(recipe.source.url).searchParams.get('recipe_no');
    const { volume, seconds } = summarize(recipe.steps);
    assert.deepEqual([volume, seconds], expected[id]);
  }
});

test('single files and old version-1 backups preserve the recipe', () => {
  const recipe = publicRecipes[0];
  assert.deepEqual(parseRecipeFile(JSON.stringify(recipe)), [recipe]);
  assert.deepEqual(parseRecipeFile(JSON.stringify([recipe])), [recipe]);
  const legacyBackup = automaticRecipe(2, 'normal', 93);
  assert.deepEqual(parseRecipeFile(`\uFEFF${JSON.stringify({ version: 1, recipes: [{ id: 'old-id', ...legacyBackup }, recipe] })}`), [legacyBackup, recipe]);
});

test('legacy HARIO records use water, time and interval in transmitted order', () => {
  const record = {
    recipe_id: '1055', user_name: '카스야', temperature: '92', coffee_grounds: '20', water: '300',
    detail: [
      { water: '50', time: '8', interval: '37' }, { water: 70, time: 7, interval: 38 },
      { water: 60, time: 6, interval: 35 }, { water: 60, time: 6, interval: 35 },
      { water: 60, time: 6, interval: 30 }, { water: '0', time: '0', interval: '0' }
    ]
  };
  for (const input of [record, { status_code: true, data: [record] }]) {
    const [converted] = parseRecipeFile(JSON.stringify(input));
    assert.equal(converted.name, '카스야');
    assert.equal(converted.grounds, 20);
    assert.deepEqual(converted.steps, publicRecipes[0].steps);
    assert.equal(converted.source.url, publicRecipes[0].source.url);
  }
  assert.throws(() => parseRecipeFile(JSON.stringify({ ...record, water: 700 })), /합계/);
  assert.throws(() => parseRecipeFile(JSON.stringify({ ...record, detail: [...record.detail, { water: 0, time: 0, interval: 2 }] })), /물량/);
});

test('malformed recipes and unsafe attribution links are rejected', () => {
  assert.throws(() => parseRecipeFile('no JSON'), /올바른 JSON/);
  assert.throws(() => parseRecipeFile('{"version":1,"recipes":[]}'), /JSON 파일/);
  const recipe = publicRecipes[0];
  assert.throws(() => parseRecipeFile(JSON.stringify([recipe, { ...recipe, temperature: 99 }])), /2번째 레시피/);
  assert.throws(() => validateRecipe({ ...recipe, source: { label: 'recipe', url: 'javascript:alert(1)' } }), /HTTPS 주소/);
});
