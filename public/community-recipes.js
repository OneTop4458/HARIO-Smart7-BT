import { validateRecipe } from './recipes.js';

const repository = 'https://github.com/OneTop4458/smart7-offline';
const apiOrigin = 'https://api.github.com';
const api = apiOrigin + '/repos/OneTop4458/smart7-offline/issues';

function hasLabel(issue, name) {
  return issue.labels?.some(label => label.name === name);
}

export function issueUrl(number) {
  return `${repository}/issues/${number}`;
}

function safeHttps(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password ? url.href : '';
  } catch { return ''; }
}

function recipeDetails(record) {
  if (!record || typeof record !== 'object') return undefined;
  const text = key => typeof record[key] === 'string' ? record[key].trim() : '';
  return { beans: text('beans'), grind: text('grind'), description: text('description'), source: safeHttps(record.source) };
}

const languages = ['ko', 'en', 'ja'];

function issueTranslations(record) {
  const entries = languages.flatMap(language => {
    const fields = record?.[language];
    if (!fields || typeof fields !== 'object') return [];
    const values = Object.fromEntries(['title', 'description', 'beans', 'grind'].flatMap(key =>
      typeof fields[key] === 'string' && fields[key].trim() ? [[key, fields[key].trim()]] : []));
    return Object.keys(values).length ? [[language, values]] : [];
  });
  return entries.length ? Object.fromEntries(entries) : undefined;
}

export function recipeProposalUrl(recipe, fields) {
  const { name, temperature, grounds, steps, beans, grind } = validateRecipe(recipe);
  const details = recipeDetails({ beans, grind, ...fields, source: fields.source || recipe.source?.url });
  const originalLanguage = languages.includes(fields.language) ? fields.language : undefined;
  const translations = issueTranslations(fields.translations);
  const lines = [
    '## 원두 / Beans', details.beans || '—',
    '## 분쇄도 / Grind', details.grind || '—',
    '## 추출 메모 / Brew notes', details.description || '—',
    '## 출처 / Source', details.source || '—',
    '## 사진 / Photo', '<!-- Attach a photo here using GitHub. -->',
    '## 추출 설정 / Brew settings', [
      '```json', JSON.stringify({ name, temperature, grounds, steps, details, language: originalLanguage, translations }), '```'
    ].join('\n')
  ];
  const url = new URL(repository + '/issues/new');
  url.searchParams.set('template', 'recipe.md');
  url.searchParams.set('title', `[레시피] ${name}`);
  url.searchParams.set('body', lines.join('\n\n'));
  if (url.href.length > 7500) throw new Error('공유 내용이 너무 깁니다. 메모나 출처 주소를 줄여 주세요.');
  return url.href;
}

export function isCommunityIssue(issue) {
  return issue?.state === 'open' && !issue.pull_request
    && (issue.title.startsWith('[레시피]') || hasLabel(issue, 'recipe'));
}

export function issueTitle(issue, attachment, language) {
  const localized = attachment?.archive?.titles?.[language] ?? attachment?.translations?.[language]?.title;
  if (typeof localized === 'string' && localized.trim()) return localized.trim();
  return issue.title.replace(/^\[레시피\]\s*/, '');
}

export function issueImage(issue) {
  const markdown = issue.body || '';
  const images = markdown.matchAll(/!\[[^\]\r\n]*\]\(\s*<?(https:\/\/[^\s>)]+)>?|<img\b[^>]*?\bsrc\s*=\s*["'](https:\/\/[^"'\s]+)["']/gi);
  for (const match of images) {
    const href = safeHttps(match[1] || match[2]);
    if (!href) continue;
    const { origin, pathname } = new URL(href);
    if (origin === 'https://github.com' && /^\/user-attachments\/assets\/[\da-f-]+$/i.test(pathname)) return href;
    if (origin === 'https://user-images.githubusercontent.com' && /\.(?:png|jpe?g|webp|gif)$/i.test(pathname)) return href;
  }
  return '';
}

export function issueRecipe(issue) {
  const match = (issue.body || '').match(/^\x60{3}json[ \t]*\r?\n([\s\S]*?)^\x60{3}[ \t]*\r?$/im);
  if (!match) return null;
  try {
    const { name, temperature, grounds, steps, source, archive, details, language, translations } = JSON.parse(match[1]);
    const original = hasLabel(issue, 'recipe-archive') && Number.isSafeInteger(archive?.id)
      ? { ...archive, guide: safeHttps(archive.guide) } : undefined;
    const attribution = original && source ? source : { label: `GitHub · #${issue.number}`, url: issueUrl(issue.number) };
    const metadata = recipeDetails(details);
    const beans = original && Array.isArray(original.beans) ? original.beans[0] : metadata?.beans;
    const grind = original?.grind ?? metadata?.grind;
    const recipe = validateRecipe({
      name, temperature, grounds, steps, source: attribution,
      beans: typeof beans === 'string' ? beans.slice(0, 60) : undefined,
      grind: typeof grind === 'string' ? grind.slice(0, 30) : undefined
    });
    return {
      recipe, archive: original, details: metadata, language: languages.includes(language) ? language : undefined,
      translations: issueTranslations(translations), body: issue.body.replace(match[0], '').trim()
    };
  } catch { return null; }
}

async function getGitHub(url) {
  const response = await fetch(url, { cache: 'no-cache', signal: AbortSignal.timeout(10000) });
  if (response.status === 404) return { data: null };
  if (!response.ok) throw new Error(`GitHub returned HTTP ${response.status}`);
  const next = response.headers.get('link')?.match(/<([^>]+)>;\s*rel="next"/)?.[1];
  return { data: await response.json(), next: next && new URL(next).origin === apiOrigin ? next : null };
}

async function listGitHub(path) {
  let url = api + path;
  const items = [];
  while (url) {
    const { data, next } = await getGitHub(url);
    if (!Array.isArray(data)) throw new Error('GitHub list unavailable');
    items.push(...data);
    url = next;
  }
  return items;
}

export async function listCommunityIssues() {
  return (await listGitHub('?state=open&sort=updated&per_page=100')).filter(isCommunityIssue);
}

export async function getCommunityIssue(number) {
  const { data: issue } = await getGitHub(`${api}/${number}`);
  return isCommunityIssue(issue) ? issue : null;
}

export function listIssueComments(number) {
  return listGitHub(`/${number}/comments?per_page=100`);
}
