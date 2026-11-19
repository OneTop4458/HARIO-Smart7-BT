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
      throw new Error(`${index + 1}단계의 물량을 20mL 이상, 10mL 단위로 설정하세요.`);
    }
    const min = step.volume / 10;
    const max = Math.min(80, Math.floor(step.volume / 3));
    if (!Number.isInteger(step.pour) || step.pour < min || step.pour > max) {
      throw new Error(`${index + 1}단계의 붓는 시간은 ${min}~${max}초여야 합니다.`);
    }
    if (!Number.isInteger(step.wait) || step.wait < 0 || step.wait > 60) {
      throw new Error(`${index + 1}단계의 대기 시간은 0~60초여야 합니다.`);
    }
  }
  const { volume } = summarize(recipe.steps);
  if (volume < 270 || volume > 700) throw new Error('총 물량은 270~700mL 사이여야 합니다.');
  return {
    name: recipe.name.trim(), temperature: recipe.temperature,
    steps: recipe.steps.map(({ volume, pour, wait }) => ({ volume, pour, wait }))
  };
}
