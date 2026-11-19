import { t } from './i18n.js';

const profiles = {
  normal: {
    2: [[30, 5, 25], [100, 18, 6], [70, 13, 6], [70, 13, 0]],
    3: [[40, 6, 25], [100, 15, 7], [100, 15, 7], [100, 15, 7], [70, 11, 0]],
    4: [[50, 8, 25], [120, 18, 8], [120, 18, 8], [80, 12, 8], [80, 12, 8], [80, 12, 0]],
    5: [[60, 9, 25], [150, 23, 9], [150, 23, 9], [100, 15, 9], [100, 15, 9], [100, 15, 0]]
  },
  fast: {
    2: [[30, 5, 25], [100, 15, 5], [70, 11, 5], [70, 11, 0]],
    3: [[40, 6, 25], [100, 12, 6], [100, 12, 6], [100, 12, 6], [70, 8, 0]],
    4: [[50, 8, 25], [120, 14, 7], [120, 14, 7], [80, 10, 7], [80, 10, 7], [80, 10, 0]],
    5: [[60, 9, 25], [150, 18, 8], [150, 18, 8], [100, 12, 8], [100, 12, 8], [100, 12, 0]]
  }
};

export function automaticRecipe(cups, speed, temperature) {
  return { name: `자동 추출 ${cups}잔`, temperature, steps: profiles[speed][cups].map(
    ([volume, pour, wait]) => ({ volume, pour, wait })
  ) };
}

export function summarize(steps) {
  return steps.reduce((total, step) => ({
    volume: total.volume + step.volume,
    seconds: total.seconds + step.pour + step.wait
  }), { volume: 0, seconds: 0 });
}

export function validateRecipe(recipe) {
  if (!recipe || typeof recipe.name !== 'string' || !recipe.name.trim() || recipe.name.length > 60) {
    throw new Error('레시피 이름을 1~60자 사이로 입력하세요.');
  }
  if (!Number.isInteger(recipe.temperature) || recipe.temperature < 80 || recipe.temperature > 96) {
    throw new Error('물 온도는 80~96°C 사이여야 합니다.');
  }
  if (!Array.isArray(recipe.steps) || recipe.steps.length < 1 || recipe.steps.length > 11) {
    throw new Error('추출 단계를 1~11개 입력하세요.');
  }
  for (const [index, step] of recipe.steps.entries()) {
    if (!step || !Number.isInteger(step.volume) || step.volume < 20 || step.volume > 700 || step.volume % 10) {
      throw new Error(t('{index}단계의 물량을 20mL 이상, 10mL 단위로 설정하세요.', { index: index + 1 }));
    }
    const min = step.volume / 10;
    const max = Math.min(80, Math.floor(step.volume / 3));
    if (!Number.isInteger(step.pour) || step.pour < min || step.pour > max) {
      throw new Error(t('{index}단계의 붓는 시간은 {min}~{max}초여야 합니다.', { index: index + 1, min, max }));
    }
    if (!Number.isInteger(step.wait) || step.wait < 0 || step.wait > 60) {
      throw new Error(t('{index}단계의 대기 시간은 0~60초여야 합니다.', { index: index + 1 }));
    }
  }
  const { volume } = summarize(recipe.steps);
  if (volume < 270 || volume > 700) throw new Error('총 물량은 270~700mL 사이여야 합니다.');
  const validated = {
    name: recipe.name.trim(), temperature: recipe.temperature,
    steps: recipe.steps.map(({ volume, pour, wait }) => ({ volume, pour, wait }))
  };
  if (recipe.grounds != null && recipe.grounds !== 0) {
    if (!Number.isFinite(recipe.grounds) || recipe.grounds < 0 || recipe.grounds > 100) {
      throw new Error('원두량은 100g 이하로 입력하세요.');
    }
    validated.grounds = recipe.grounds;
  }
  for (const [key, max, message] of [
    ['beans', 60, '원두는 60자 이하로 입력하세요.'],
    ['grind', 30, '분쇄도는 30자 이하로 입력하세요.']
  ]) {
    const value = recipe[key];
    if (value == null) continue;
    if (typeof value !== 'string' || value.trim().length > max) throw new Error(message);
    if (value.trim()) validated[key] = value.trim();
  }
  if (recipe.photo != null) {
    if (typeof recipe.photo !== 'string' || recipe.photo.length > 200000 || !/^data:image\/jpeg;base64,\/9j\/[A-Za-z0-9+/]*={0,2}$/.test(recipe.photo)) {
      throw new Error('레시피 사진은 200KB 이하의 JPEG여야 합니다.');
    }
    validated.photo = recipe.photo;
  }
  if (recipe.source != null) {
    const { label, url } = recipe.source;
    let link;
    if (typeof url === 'string') {
      try { link = new URL(url); } catch { /* Invalid sources are reported below. */ }
    }
    if (typeof label !== 'string' || !label.trim() || label.length > 120 || link?.protocol !== 'https:' || link.username || link.password) {
      throw new Error('레시피 출처에 HTTPS 주소와 이름을 입력하세요.');
    }
    validated.source = { label: label.trim(), url: link.href };
  }
  return validated;
}

function legacyNumber(value) {
  return typeof value === 'string' && /^\d+(?:\.\d+)?$/.test(value.trim()) ? Number(value) : value;
}

function fromSharedRecipe(recipe) {
  const steps = recipe.detail.map(step => ({
    volume: legacyNumber(step?.water), pour: legacyNumber(step?.time), wait: legacyNumber(step?.interval)
  })).filter(step => step.volume !== 0 || step.pour !== 0 || step.wait !== 0);
  const id = String(recipe.recipe_id ?? '');
  const name = [recipe.recipe_name, recipe.user_name].find(value => typeof value === 'string' && value.trim())
    || (id ? t('Smart7 레시피 {id}', { id }) : t('Smart7 공유 레시피'));
  const grounds = typeof recipe.coffee_grounds === 'string' && !recipe.coffee_grounds.trim() ? undefined : legacyNumber(recipe.coffee_grounds);
  const source = /^\d+$/.test(id) ? {
    label: `Smart7 Shared Recipes · No.${id}`, url: `https://smart7.jp/detail_kr.php?recipe_no=${id}`
  } : undefined;
  const declaredVolume = legacyNumber(recipe.water);
  if (Number.isFinite(declaredVolume) && declaredVolume > 0 && declaredVolume !== summarize(steps).volume) {
    throw new Error('공유 레시피의 총 물량과 단계별 물량 합계가 다릅니다.');
  }
  return { name, temperature: legacyNumber(recipe.temperature), grounds, source, steps };
}

export function parseRecipeFile(text) {
  let data;
  try { data = JSON.parse(text.replace(/^\uFEFF/, '')); }
  catch { throw new Error('올바른 JSON 파일을 선택하세요.'); }
  let records = data;
  if (data?.version === 1) records = data.recipes;
  else if (data?.status_code === true) records = data.data;
  else if (data?.steps || data?.detail) records = [data];
  if (!Array.isArray(records) || records.length === 0) throw new Error('레시피가 들어 있는 JSON 파일을 선택하세요.');
  return records.map((record, index) => {
    try {
      return validateRecipe(Array.isArray(record?.detail) ? fromSharedRecipe(record) : record);
    } catch (error) {
      throw new Error(t('{index}번째 레시피 · {message}', { index: index + 1, message: t(error.message) }));
    }
  });
}
