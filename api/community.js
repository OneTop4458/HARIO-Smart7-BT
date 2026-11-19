import { fetchGitHubIssues, fetchGitHubComments } from '../public/community-recipes.js';

let pendingIssues;

export default {
  async fetch(request) {
    if (request.method !== 'GET') {
      return new Response(null, { status: 405, headers: { Allow: 'GET' } });
    }

    const params = [...new URL(request.url).searchParams];
    const commentNumber = params[0]?.[1];
    if (params.length && (params.length !== 1 || params[0][0] !== 'comments' || !/^[1-9]\d{0,9}$/.test(commentNumber))) {
      return Response.json({ error: 'Invalid community request' }, { status: 400 });
    }

    try {
      let data;
      if (commentNumber) {
        data = await fetchGitHubComments(commentNumber);
      } else {
        pendingIssues ??= fetchGitHubIssues().finally(() => { pendingIssues = null; });
        data = await pendingIssues;
      }
      return Response.json(data, {
        headers: {
          'Cache-Control': 'public, max-age=15',
          'Vercel-CDN-Cache-Control': 'public, s-maxage=120'
        }
      });
    } catch (error) {
      const rateLimited = error.code === 'rate-limit';
      return Response.json({ error: rateLimited ? 'Rate limit' : 'GitHub unavailable' }, {
        status: rateLimited ? 429 : 502,
        headers: { 'Cache-Control': 'no-store' }
      });
    }
  }
};
