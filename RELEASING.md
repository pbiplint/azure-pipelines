# Releasing the task

Users write `pbiplint@1`, and Azure Pipelines runs the newest `1.x.y` of the task in the installed
extension. A release is a new extension version on the Visual Studio Marketplace, published by the
maintainer with `tfx-cli`. The task's version in `task/task.json`, the extension's in
`vss-extension.json`, and `package.json`'s move together; a test fails when they differ.

## After a pbiplint CLI release

1. On a branch, change the `pbiplintVersion` default in `task/task.json`, the version in README.md's
   inputs table, and `PBIPLINT_VERSION` in `examples/plain.yml` and README.md's copy of it. The
   manifest tests fail until all four match.
2. Move the sample pin, the `ref` of the messy-sales checkout in `.github/workflows/ci.yml`, to the
   commit the main repository's release tag points at.
3. Move the version in CONTRIBUTING.md's fixture command to the new one, then regenerate
   `test/fixtures/messy-sales.sarif` with that command from a checkout of the main repository at
   the same commit. Move the tests' pins to what the new file holds: the counts in
   `test/report.test.mjs` (`COUNTS`, the summary's "20 of N findings") and in `test/run.test.mjs`
   (`findings`, the summary line), and the first issue's file and rule id. The dogfood checks pin no
   count, so a stale fixture fails nothing; this step is easy to miss.
4. Number the release by what the CLI release does, as the GitHub Action does: one that adds rules
   or changes the findings an unchanged project gets is a minor here, since a pipeline gated with
   `failOn` can start failing when `pbiplint@1` moves; any other is a patch. Set it in
   `task/task.json` (`version`), `vss-extension.json`, and `package.json`.
5. Run `npm test`, open a pull request, let CI pass, merge.
6. Publish, as below, then tag the merge commit `v1.x.y` and push the tag, so the repository says
   which commit each Marketplace version came from.

## Publishing

The maintainer publishes from a clean checkout of main, with a personal access token for the
Visual Studio Marketplace (organization "All accessible organizations", scope Marketplace,
Publish) in `AZURE_DEVOPS_EXT_PAT`, never on the command line:

```bash
npm ci && npm test && npm run package
npx --yes tfx-cli@0.24.2 extension publish --vsix dist/pbiplint.pbiplint-1.x.y.vsix --auth-type pat --token "$AZURE_DEVOPS_EXT_PAT"
```

The extension stays private (`"public": false` in `vss-extension.json`) until a pbiplint release
makes it public. While private, share it with each organization that tests it:

```bash
npx --yes tfx-cli@0.24.2 extension share --publisher pbiplint --extension-id pbiplint --share-with <organization> --auth-type pat --token "$AZURE_DEVOPS_EXT_PAT"
```

The organization's administrator then installs it from Organization settings, Extensions, Shared.

## After publishing

Run the test pipeline in the test organization on the new version: the task on the sample project
gives build issues, the summary on the Extensions tab, the `CodeAnalysisLogs` artifact, and a
failed step; the same pipeline with `failOn: none` passes. The organization uses the free
Microsoft-hosted job only, which allows 1,800 minutes a month, so keep the test runs to a few
minutes each.

## Going public

The first public release sets `"public": true` in `vss-extension.json` in its release pull request
and publishes as above. The Marketplace listing takes its name, description, icon, and the README
from the extension. Making an extension public cannot be undone.

## Pinned actions and tools

`actions/*` are pinned by major, as in the main repository; Dependabot proposes bumps for them and
for the development dependencies. `tfx-cli` is pinned in `package.json`'s `package` script and in
the commands above, and moved by hand.
