# Live test execution

This is a separate local observer, not part of the product application and not
a generated Markdown/JSON report.

Running `npm test` starts (or reuses) the local observer at
`http://127.0.0.1:4319`, opens it in a browser window on macOS, and streams the
test run to it. The observer discovers test files by walking `tests/` on every
run. It does not import a maintained test catalogue.

The live window shows, in order:

1. the complete discovered test-file count;
2. each test file as it starts;
3. each named test as it passes or fails;
4. the final selected-suite outcome;
5. the exact source around a named test when you click it in the observer.

`npm test` runs discovered Node tests. `npm run test:e2e` runs discovered
browser specs. `npm run audit:all` runs both. The observer is intentionally
best-effort: if the UI cannot start, the test command and its exit status still
behave normally.

Gherkin remains the behaviour definition in `ai-investment.feature`. A test
run only claims what the executable test actually names and exercises; it does
not invent a scenario link from a green result.
