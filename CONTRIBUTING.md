# Contributing

NAS Hub is maintained as time allows. It is one person's project, so please expect slow replies.

- **Bugs:** open an issue with the version (shown next to the name in the app), your device and browser, and the exact message you saw.
- **Small fixes:** pull requests are welcome. Keep each one to a single change.
- **Big ideas:** open an issue first so nobody builds something that will not be merged.

The app is one file, `app/index.html`, with no build step. To try a change, serve the `app` folder (`python3 -m http.server 8099 --directory app`) and open it in a browser. The click through tests in `test/` need Node and Playwright.

By contributing you agree that your work is released under the MIT license.
