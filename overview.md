# pbiplint for Azure Pipelines

Lint Power BI projects in Azure Pipelines. One step in your pipeline runs
[pbiplint](https://pbiplint.com), an open-source linter for Power BI projects saved in the PBIP
format, against the project in your repository: its semantic model (TMDL) and its report (PBIR).
The findings become a pass/fail step, build issues with their file and line, a readable report on
the run, and a SARIF file.

```yaml
pool:
  vmImage: ubuntu-latest

steps:
  - task: pbiplint@1
    inputs:
      path: Sales.pbip
```

## What a run does

- **Fails the step** when findings reach the `failOn` severity (errors by default), so a pull
  request with a build validation policy cannot complete while the project breaks a rule. Set
  `failOn: none` to report without ever failing.
- **Reports findings as build issues** with their file, line, and rule id. The agent keeps 10
  errors and 10 warnings per step; the report on the run has every finding.
- **Puts the full report on the run's Extensions tab**, ranked, with a link to each rule's page.
  When the project has a report, "Report at a glance" says what it will do when someone opens it.
- **Publishes the SARIF report** as the `CodeAnalysisLogs` build artifact, which the
  [SARIF SAST Scans Tab](https://marketplace.visualstudio.com/items?itemName=sariftools.scans)
  extension shows, and which GitHub Advanced Security for Azure DevOps can take in.

The semantic model is checked against Microsoft's best-practice ruleset for semantic models, ported
and verified, and pbiplint's own rules. The report is checked against the base rules of PBI
Inspector, ported, and pbiplint's own rules for a report's correctness and readiness. Every rule
has a page at [pbiplint.com/rules](https://pbiplint.com/rules/) with what it checks, why, and how
to fix it. A `pbiplint.config.json` next to your project turns rules off or changes their
severity; the task picks it up.

## Inputs

| Input             | Default            | What it does                                                                                                                                                  |
| ----------------- | ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `path`            | `.`                | What to lint, relative to the pipeline's working folder: a PBIP folder, a `.pbip` file, a `.SemanticModel` or `.Report` folder, a `definition` folder, or one `.tmdl` file. |
| `failOn`          | `error`            | Lowest severity that fails the step: `error`, `warning`, `info`, or `none`.                                                                                   |
| `config`          |                    | A `pbiplint.config.json` to use. By default the nearest one above the project applies.                                                                        |
| `pbiplintVersion` | `0.2.5`            | The pbiplint version to run. Each release of this task pins the current one.                                                                                 |
| `annotations`     | `true`             | Report findings as build issues.                                                                                                                              |
| `publishSarif`    | `true`             | Publish the SARIF report as a build artifact.                                                                                                                 |
| `artifactName`    | `CodeAnalysisLogs` | The artifact the SARIF report goes to. The SARIF SAST Scans Tab reads only `CodeAnalysisLogs`.                                                                |
| `sarifCategory`   | `pbiplint`         | The name of this step's report files. Give each step its own when one job lints several projects.                                                             |

Output variables `exitCode`, `sarifFile`, `findings`, `errors`, `warnings`, and `infos` are there
for later steps. The
[full documentation](https://github.com/pbiplint/azure-pipelines#readme) covers them, several
projects in one job, and the publish step for GitHub Advanced Security for Azure DevOps.

## What leaves your organization

Nothing from your project. The step fetches the pinned pbiplint package from the npm registry and
lints on the agent; the findings go only to the run, its artifact, and, if your team adds it,
Advanced Security in your own organization.
[Pipelines: GitHub Actions and Azure Pipelines](https://pbiplint.com/pipelines/#azure-pipelines)
lists what each step sends where, with a record of the hosts an agent reached, and how to check it.

## Requirements

- The Microsoft-hosted Ubuntu, Windows, or macOS agents, or a self-hosted agent, version 4.248.0 or
  later, with Node.js 20.19 or later in the 20 line, or 22.12 or later, and npm on the PATH.
- No service connection, secret, or permission beyond the pipeline's own.

## No extension? The plain YAML route

If your organization cannot install extensions, the same linter runs from one script step with
`npx`, with the same report on the Extensions tab and the same SARIF artifact:
[the plain YAML route](https://github.com/pbiplint/azure-pipelines#the-plain-yaml-route).

## Support

This task is MIT licensed, and pbiplint itself is open source under the AGPL; both are maintained in the open by McKinley Consulting.
Questions and bugs in the task:
[github.com/pbiplint/azure-pipelines/issues](https://github.com/pbiplint/azure-pipelines/issues).
Questions about a rule or a finding:
[github.com/pbiplint/pbiplint/issues](https://github.com/pbiplint/pbiplint/issues). The pbiplint
Privacy Promise: [pbiplint.com/privacy](https://pbiplint.com/privacy/).
