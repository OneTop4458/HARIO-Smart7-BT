export function canTranslateRecipe(language) {
  return !!globalThis.Translator && (!!language || !!globalThis.LanguageDetector);
}

export function translationLink(fields, targetLanguage, sourceLanguage) {
  const url = new URL('https://translate.google.com/');
  url.searchParams.set('sl', sourceLanguage || 'auto');
  url.searchParams.set('tl', targetLanguage);
  url.searchParams.set('text', Object.values(fields).filter(Boolean).join('\n\n').slice(0, 2500));
  url.searchParams.set('op', 'translate');
  return url.href;
}

export async function translateRecipe(fields, targetLanguage, sourceLanguage) {
  const entries = Object.entries(fields).filter(([, value]) => !!value);
  if (!sourceLanguage) {
    const detector = await globalThis.LanguageDetector.create();
    try {
      const detected = await detector.detect(entries.map(([, value]) => value).join('\n'));
      sourceLanguage = detected[0]?.detectedLanguage;
    } finally {
      detector.destroy();
    }
  }
  if (sourceLanguage === targetLanguage) return fields;
  if (!sourceLanguage || sourceLanguage === 'und') throw new Error('Unknown source language');
  const translator = await globalThis.Translator.create({ sourceLanguage, targetLanguage });
  try {
    return Object.fromEntries(await Promise.all(entries.map(async ([key, value]) => [key, await translator.translate(value)])));
  } finally {
    translator.destroy();
  }
}
