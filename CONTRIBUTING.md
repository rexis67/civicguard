# Contributing

Thanks for helping improve CivicGuard. Contributions should preserve resident
privacy, accessibility, and the existing API behavior unless a change is
intentional and documented.

## Before opening a pull request

1. Open an issue for substantial changes so the scope can be discussed.
2. Keep changes focused and avoid adding real personal or municipal incident data.
3. Update the relevant documentation and tests with behavior changes.
4. Run the checks below and include their results in the pull request.

## Development

- Node.js 20 or newer
- npm

```sh
npm ci
npm --prefix backend ci
npm run build
npm run test:smoke
npx playwright install chromium
npm run test:e2e
```

The smoke suite starts an isolated backend with temporary SQLite and upload
directories. Playwright runs the built application against a separate temporary
database. AI provider credentials are not required for either test suite.

## Pull requests

Describe the user impact, implementation, and any operational or migration
considerations. Include screenshots for visual changes when useful. Keep secrets
out of code, logs, fixtures, and screenshots. Do not remove required project
documents or evidence files.

By submitting a contribution, you agree that it may be distributed under the
repository's existing license.
