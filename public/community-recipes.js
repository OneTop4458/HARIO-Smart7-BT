import { validateRecipe } from './recipes.js';

const repository = 'https://github.com/OneTop4458/smart7-offline';
const api = 'https://api.github.com/repos/OneTop4458/smart7-offline/issues';

export function issueUrl(number) {
  return `${repository}/issues/${number}`;
}

export function recipeProposalUrl(title, message, recipe) {
  const lines = [message.trim()];
  if (recipe) {
    const { name, temperature, grounds, steps } = validateRecipe(recipe);
    lines.push('', '```json', JSON.stringify({ name, temperature, grounds, steps }), '```');
    if (recipe.source?.url.length < 500) lines.push('', recipe.source.label, recipe.source.url);
  }
  const url = new URL(repository + '/issues/new');
  url.searchParams.set('template', 'recipe.md');
  url.searchParams.set('title', `[레시피] ${title.trim()}`);
  url.searchParams.set('body', lines.join('\n').trim());
  return url.href;
}

export function isCommunityIssue(issue) {
  return issue?.state === 'open' && !issue.pull_request
    && (issue.title.startsWith('[레시피]') || issue.labels.some(label => label.name === 'recipe'));
}

export function issueRecipe(issue) {
  const match = (issue.body || '').match(/^\x60{3}json[ \t]*\r?\n([\s\S]*?)^\x60{3}[ \t]*\r?$/im);
  if (!match) return null;
  try {
    const { name, temperature, grounds, steps } = JSON.parse(match[1]);
    const source = { label: `GitHub · #${issue.number}`, url: issueUrl(issue.number) };
    return { recipe: validateRecipe({ name, temperature, grounds, steps, source }), body: issue.body.replace(match[0], '').trim() };
  } catch { return null; }
}

async function getGitHub(path) {
  const response = await fetch(api + path, { cache: 'no-cache', signal: AbortSignal.timeout(10000) });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`GitHub returned HTTP ${response.status}`);
  return response.json();
}

export async function listCommunityIssues() {
  const issues = await getGitHub('?state=open&sort=updated&per_page=100');
  return issues?.filter(isCommunityIssue) ?? [];
}

export async function getCommunityIssue(number) {
  const issue = await getGitHub('/' + number);
  return isCommunityIssue(issue) ? issue : null;
}

export function listIssueComments(number) {
  return getGitHub(`/${number}/comments?per_page=100`);
}
