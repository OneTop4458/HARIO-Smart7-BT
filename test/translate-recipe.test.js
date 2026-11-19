import assert from 'node:assert/strict';
import test from 'node:test';
import { canTranslateRecipe, translateRecipe, translationLink } from '../public/translate-recipe.js';

test('the browser translator uses the selected language without translating brew settings', async context => {
  const restored = Object.getOwnPropertyDescriptor(globalThis, 'Translator');
  let destroyed = false;
  Object.defineProperty(globalThis, 'Translator', { configurable: true, value: {
    async create(options) {
      assert.deepEqual(options, { sourceLanguage: 'ko', targetLanguage: 'ja' });
      return { translate: async value => value === '아침' ? '朝' : '中挽き', destroy: () => { destroyed = true; } };
    }
  } });
  context.after(() => {
    if (restored) Object.defineProperty(globalThis, 'Translator', restored);
    else delete globalThis.Translator;
  });
  assert.equal(canTranslateRecipe('ko'), true);
  assert.deepEqual(await translateRecipe({ title: '아침', grind: '중간' }, 'ja', 'ko'), { title: '朝', grind: '中挽き' });
  assert.equal(destroyed, true);
});

test('the external translation link uses the selected language and supplied public text', () => {
  const url = new URL(translationLink({ title: '아침', description: '메모' }, 'en'));
  assert.equal(url.origin, 'https://translate.google.com');
  assert.equal(url.searchParams.get('sl'), 'auto');
  assert.equal(url.searchParams.get('tl'), 'en');
  assert.equal(url.searchParams.get('text'), '아침\n\n메모');
});
