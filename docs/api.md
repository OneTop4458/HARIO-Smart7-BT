# HTTP API and recipe format

The production site serves static files from `public/` and one read-only HTTP endpoint for the recipe community. The browser connects directly to the brewer over [Bluetooth](smart7-analysis.md).

## Community API

Base URL `https://smart7-offline.vercel.app`

| Request | Successful response |
| --- | --- |
| `GET /api/community` | Array of open GitHub issue objects, sorted by latest update |
| `GET /api/community?comments=1` | Array of GitHub comment objects for issue #1 |

```sh
curl 'https://smart7-offline.vercel.app/api/community'
curl 'https://smart7-offline.vercel.app/api/community?comments=1'
```

The endpoint returns GitHub objects directly. The UI uses `number`, `title`, `body`, `labels[].name`, `comments`, and `user.login` from issues and `body` and `user.login` from comments. The list includes open issues with the `recipe` label or a `[레시피]` title prefix and excludes pull requests. Comment requests take one positive issue number of at most 10 digits. The browser opens a detail view by finding the issue in the list, then fetches comments when the issue has any. [API implementation](../api/community.js) · [GitHub client](../public/community-recipes.js)

| Status | Meaning |
| --- | --- |
| `200` | JSON array, possibly empty |
| `400` | Invalid query, with `{"error":"Invalid community request"}` |
| `405` | Unsupported method, with `Allow: GET` and an empty body |
| `429` | GitHub rate limit, with `{"error":"Rate limit"}` |
| `502` | GitHub read failed, with `{"error":"GitHub unavailable"}` |

Successful responses specify a 15-second browser cache and a 120-second Vercel CDN cache. The endpoint combines concurrent requests for the issue list within the same running instance. The client follows GitHub pagination and falls back to direct GitHub reads if the relay is unreachable. Closing an issue removes it from the app when a fresh list is fetched. [Endpoint tests](../test/community-api.test.js)

## Recipe JSON

The following is a valid version 1 export. `volume` is the water dispensed in a step in mL. `pour` and `wait` are durations in seconds. The estimated time includes all pours and waits, starting once the brewer has finished heating.

```json
{
  "version": 1,
  "recipes": [
    {
      "name": "Example 270 mL",
      "temperature": 93,
      "grounds": 18,
      "steps": [
        { "volume": 30, "pour": 5, "wait": 25 },
        { "volume": 100, "pour": 18, "wait": 6 },
        { "volume": 70, "pour": 13, "wait": 6 },
        { "volume": 70, "pour": 13, "wait": 0 }
      ]
    }
  ]
}
```

| Field | Validation |
| --- | --- |
| `name` | Required text, 1–60 characters with a nonblank name |
| `temperature` | Integer from 80 to 96 °C |
| `steps` | 1–11 steps totaling 270–700 mL |
| `steps[].volume` | 20–700 mL in 10 mL increments |
| `steps[].pour` | Integer from `volume / 10` to `min(80, floor(volume / 3))` seconds |
| `steps[].wait` | Integer from 0 to 60 seconds |
| `grounds` | Optional finite number from 0 to 100 g. Zero means unspecified |
| `beans`, `grind` | Optional text, up to 60 and 30 characters after trimming |
| `photo` | Optional JPEG data URL, up to 200,000 characters |
| `source` | Optional object with a nonblank `label` up to 120 characters and an HTTPS `url` without credentials |

Import accepts a version 1 export, an array of recipes, or one recipe object. It also accepts exported legacy shared-recipe JSON with `detail[]` rows (`water`, `time`, `interval`) or the legacy `{"status_code":true,"data":[...]}` envelope. Legacy numeric strings are converted to numbers, all-zero rows are skipped, and a positive declared water total must match the steps. One invalid record rejects the import and reports its position. [Validator and importer](../public/recipes.js)

## Sharing a recipe

**Share Recipe** opens a prefilled GitHub issue draft. The user publishes the issue or posts comments while signed in to GitHub. The first fenced `json` block in the issue body contains one recipe object. Keep a recipe's languages in the same issue, and attach any image in the **Photo** section using GitHub. [Issue template](../.github/ISSUE_TEMPLATE/recipe.md)

| Additional issue field | Purpose |
| --- | --- |
| `details` | Original `beans`, `grind`, `description`, and HTTPS `source` URL |
| `language` | Language of the original text (`ko`, `en`, or `ja`) |
| `translations` | Object keyed by language code. Entries can include `title`, `description`, `beans`, and `grind` |
| `archive`, `source` | For issues labeled `recipe-archive`, the archive record has a numeric `id` and can include localized `titles`, `beans`, `description`, grind, ice, photo category, and a guide link. The top-level `source` identifies the original recipe |

For community recipes, issue attachments supply the image. The app recognizes GitHub user attachment URLs and the older GitHub user-image URLs. If an image is unavailable, the app uses an attributed reference photo. The app uses a supplied translation when available and offers browser translation or an external translation link for community text. Temperatures, quantities, and step durations come from the shared recipe JSON for every language. An issue with missing or invalid brew settings can still appear as a discussion. [Issue parser](../public/community-recipes.js) · [Translation behavior](../public/translate-recipe.js) · [Photo credits](../THIRD_PARTY_NOTICES.md)
