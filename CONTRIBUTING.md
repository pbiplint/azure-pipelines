# Contributing

```bash
npm install
npm test        # unit tests for the task script and the manifests
npm run lint    # eslint and prettier
npm run package # build the extension into dist/ with tfx-cli
```

The task is `task/task.json` plus three scripts: `task/run.mjs`, the entry; `task/main.mjs`, which
runs the CLI; and `task/report.mjs`, which turns its SARIF report into Azure Pipelines logging
commands. None has dependencies. The unit tests read `test/fixtures/messy-sales.sarif`, the CLI's SARIF output for the main repository's
`examples/messy-sales` at the pinned version. Regenerate it from a checkout of
https://github.com/pbiplint/pbiplint when the CLI's output changes:

```bash
npx pbiplint@0.2.4 examples/messy-sales --format sarif --output ../pbiplint-azure-pipelines/test/fixtures/messy-sales.sarif
```

Inputs default in `task.json` only; `main.mjs` reads them from there. Input and output variable
names take letters and digits only, as the task schema requires.

## The dogfood run

`test/dogfood.mjs` runs the task script three times and the plain route's script once against a
sample project, with the real CLI from npm and the agent's environment set by hand. CI runs it on
Ubuntu and Windows. Locally, from this folder (not from inside a pbiplint checkout, where npx finds
the workspace package instead of npm's):

```bash
node test/dogfood.mjs ../pbiplint/examples/messy-sales
# against a local build of the CLI: npm pack -w pbiplint in the main repository, then
PBIPLINT_DOGFOOD_VERSION=file:/path/to/pbiplint-0.2.4.tgz node test/dogfood.mjs ../pbiplint/examples/messy-sales
```

What the dogfood cannot show is the agent itself: that it runs the task, shows the build issues and
the summary, and keeps the artifact. That takes a pipeline in a test organization; see
RELEASING.md.

Bugs in the rules or the report belong in the main repository:
https://github.com/pbiplint/pbiplint/issues. This repository is for the task itself.
