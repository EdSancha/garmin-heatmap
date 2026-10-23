# garmin-heatmap

Garmin Connect data as GitHub-style activity grids for static sites (first user: edsancha.com, a
Jekyll site with no npm). Plain ES modules, no runtime or dev dependencies, no build step:
`src/` is what browsers and Node load.

## Layout

| Path | What it is |
|---|---|
| `src/garmin.js` | Personal API client: token exchange, retrying `get`, one fetcher per source |
| `src/aggregate.js` | Raw API records → one record per day. Defines the published data format |
| `src/metrics.js` | Metric presets (value, unit, thresholds, summary, palette) and bucketing |
| `src/render.js` | Dataset + options → SVG string. DOM-free; also `OPTION_NAMES` and `parseOptions` |
| `src/build.js` | Config of grids → the sources and dates to fetch, and one SVG per enabled grid |
| `src/element.js` | `<garmin-heatmap>` custom element (browser only) |
| `src/dates.js` | `YYYY-MM-DD` helpers, always UTC |
| `bin/garmin-heatmap.js` | CLI: `build`, `fetch`, `render` |
| `examples/` | Demo page, made-up `sample.json` (`npm run sample`), workflow for a site repo |

## Rules

- **Privacy:** the dataset is published. `aggregate.js` keeps daily totals only. Never add
  activity names, IDs, coordinates, timestamps or anything that locates Eduardo.
- **Never log the API key or access token**, or put either in an error message (a test checks).
  Keep the README's Security section true when changing how the key is used.
- Keep `render.js`, `metrics.js` and `dates.js` free of Node and DOM APIs; they run in both.
- Options are kebab-case strings in HTML, CLI and config, camelCase in JS. A new option goes in
  `OPTION_NAMES`, `parseOptions` and the README table. A new metric declares its `source`.
- `build` fetches only what enabled grids need. Keep it that way: it is the privacy default.
- Tests: `npm test` (`node:test`). Use `examples/sample.json` or inline fixtures, never real data.

## Garmin Personal API

Base `https://personal.connectapi.garmin.com`. `POST /personalapitoken-service/personal-api/personal-api-key/token`
with `Authorization: ApiKey <key>` returns a 24-hour token, sent as `Bearer`. The OpenAPI spec is
embedded in the JS of https://developer.garmin.com/gc-developer-program/personal/swagger-docs/.
Documented limits: sleep summaries 31 days per call, daily summaries one year.

Not yet checked against a real key (October 2026): the token response shape (`getAccessToken`
accepts several), the `sleepScores.overall` key, and the HRV range limit (we use 31 days).

## Commits

Author every commit as Eduardo (`EdSancha <edsancha@gmail.com>`) and end the message with a
`Co-Authored-By: Claude …` trailer. Work on a branch and open a PR; Eduardo merges.
