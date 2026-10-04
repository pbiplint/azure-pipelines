# pbiplint for Azure Pipelines

Lint Power BI projects in Azure Pipelines. One step in your pipeline runs
[pbiplint](https://pbiplint.com) against the project in your repository, its semantic model and its
report, and turns the findings into a pass/fail step, build issues with their file and line, a
readable summary on the run, and a SARIF report. Nothing from your project leaves your organization,
and the one request beyond it is the pinned pbiplint download from npm;
[Pipelines: GitHub Actions and Azure Pipelines](https://pbiplint.com/pipelines/#azure-pipelines)
lists what each step sends where, and how to check it.

```yaml
trigger:
  branches:
    include: [main]

pool:
  vmImage: ubuntu-latest

steps:
  - task: pbiplint@1
    inputs:
      path: Sales.pbip
```

The task comes from the
[pbiplint extension on the Visual Studio Marketplace](https://marketplace.visualstudio.com/items?itemName=pbiplint.pbiplint),
which an organization administrator installs once. If your organization cannot install extensions, use
[the plain YAML route](#the-plain-yaml-route) below: the same CLI and the same report, with no
extension.

## What a run does

- **Fails the step** when findings reach the `failOn` severity (errors by default), so a pull
  request with a build validation policy cannot complete while the project breaks a rule. Set
  `failOn: none` to report without ever failing.
- **Reports each finding as a build issue**, with its file, line, and rule id, on the run's summary
  page. The agent keeps at most 10 errors and 10 warnings per step, and Azure Pipelines has no
  info level, so the run summary has the rest.
- **Writes the full report to the run summary**, ranked, with a link to each rule's page, on the
  run's Extensions tab. When the project has a report, its "Report at a glance" says what the report
  will do when someone opens it, whether or not anything fired.
- **Publishes the SARIF report** as the `CodeAnalysisLogs` build artifact, where the
  [SARIF SAST Scans Tab](https://marketplace.visualstudio.com/items?itemName=sariftools.scans)
  extension from Microsoft DevLabs shows it, and where GitHub Advanced Security for Azure DevOps can
  pick it up (see [below](#advanced-security)).

The rules are the ones pbiplint runs everywhere. The semantic model is checked against Microsoft's
best-practice ruleset, ported and verified, and pbiplint's own rules for a year or a date fixed in
DAX, for DAX user-defined functions, for translations, and for decimal columns' format strings. The
report, in the PBIR format, is checked against the 11 base rules of PBI Inspector, ported, and
pbiplint's own rules for a report's correctness and readiness and for the model objects the report
never reaches. Every rule has a page at https://pbiplint.com/rules with what it checks, why, and
how to fix it. Configure rules with a `pbiplint.config.json` next to your project, as on the
command line; the task picks it up.

## Inputs

The inputs are those of the [GitHub Action](https://github.com/pbiplint/action), in Azure's
spelling: a task input name allows no hyphen, so `fail-on` is `failOn` here.

| Input             | Default            | What it does                                                                                                                                                  |
| ----------------- | ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `path`            | `.`                | What to lint, relative to the pipeline's working folder (the repository, in a job with one checkout): a PBIP folder, a `.pbip` file, a `.SemanticModel` or `.Report` folder, a `definition` folder, or one `.tmdl` file. |
| `failOn`          | `error`            | Lowest severity that fails the step: `error`, `warning`, `info`, or `none`.                                                                                   |
| `config`          |                    | A `pbiplint.config.json` to use. By default the nearest one above the project applies.                                                                        |
| `pbiplintVersion` | `0.2.5`            | The pbiplint CLI version to run. Each release of this task pins the current one; override to try a newer CLI early.                                           |
| `annotations`     | `true`             | Report findings as build issues.                                                                                                                              |
| `publishSarif`    | `true`             | Publish the SARIF report as a build artifact.                                                                                                                 |
| `artifactName`    | `CodeAnalysisLogs` | The artifact the SARIF report goes to. The SARIF SAST Scans Tab reads only `CodeAnalysisLogs`.                                                                |
| `sarifCategory`   | `pbiplint`         | The name of this step's report files. Give each step its own when one job lints several projects.                                                             |

## Output variables

Give the step a `name` and read them in later steps as `$(<name>.<variable>)`.

| Variable    | What it holds                                                                                                                                        |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `exitCode`  | pbiplint's exit code: `0` no findings at or above `failOn`, `1` findings at or above `failOn`, `2` usage or input error, or pbiplint could not run. |
| `sarifFile` | Path of the SARIF report, under the agent's temp folder.                                                                                             |
| `findings`  | Number of findings.                                                                                                                                  |
| `errors`    | Number of error findings.                                                                                                                            |
| `warnings`  | Number of warning findings.                                                                                                                          |
| `infos`     | Number of info findings.                                                                                                                             |

## Several projects

One step per project. Point `path` at each and give each its own `sarifCategory`, so their report
files keep apart:

```yaml
- task: pbiplint@1
  inputs:
    path: Sales.pbip
    sarifCategory: sales
- task: pbiplint@1
  inputs:
    path: Finance.pbip
    sarifCategory: finance
```

Both SARIF files go to the one `CodeAnalysisLogs` artifact. A `.pbip` file names its report, and the
report names its model, so two projects saved in one folder lint apart.

## Advanced Security

Teams with GitHub Advanced Security for Azure DevOps, a paid add-on, can send the findings to its
code scanning alerts. A task cannot run another task, so add Microsoft's publish step after this
one; it reads every SARIF file in the folder the task writes to:

```yaml
- task: pbiplint@1
  inputs:
    path: Sales.pbip
- task: AdvancedSecurity-Publish@1
  condition: succeededOrFailed()
  inputs:
    SarifsInputDirectory: $(Agent.TempDirectory)/pbiplint
```

It needs pbiplint 0.2.4 or later, the first to write the tool's full name, which the service asks
for. The task runs 0.2.5 by default; mind it if you set an older `pbiplintVersion`. The run's automation details, which name the pipeline,
come from the publish step. The SARIF file passes Microsoft's SARIF validator, and its Azure DevOps
rules ask for nothing more. This setup has not been run against the service itself, since it needs
the paid add-on; if it does not work for you,
[open an issue](https://github.com/pbiplint/azure-pipelines/issues). The same step works after the
plain YAML route below, with `SarifsInputDirectory: $(Agent.TempDirectory)/pbiplint`.

## The plain YAML route

Installing an extension needs an organization administrator, which many teams cannot get. The
same CLI runs from a script step with no extension at all. Copy
[`examples/plain.yml`](examples/plain.yml) to `azure-pipelines.yml` in your repository and set
`PBIPLINT_PATH`:

```yaml
trigger:
  branches:
    include: [main]

pool:
  vmImage: ubuntu-latest

steps:
  - bash: |
      set +e # pbiplint's exit code is read below, not acted on
      out="$AGENT_TEMPDIRECTORY/pbiplint"
      mkdir -p "$out"
      rm -f "$out/pbiplint.sarif" "$out/pbiplint.md"
      args=("$PBIPLINT_PATH" --fail-on "$PBIPLINT_FAIL_ON")
      harmless='s/##[vV][sS][oO]\[/##[vso]/g'
      npx --yes "pbiplint@$PBIPLINT_VERSION" "${args[@]}" --format sarif --output "$out/pbiplint.sarif" 2>&1 | sed "$harmless"
      code=${PIPESTATUS[0]}
      if [ "$code" -ne 0 ] && [ ! -s "$out/pbiplint.sarif" ]; then code=2; fi
      if [ "$code" -ne 2 ]; then
        npx --yes "pbiplint@$PBIPLINT_VERSION" "${args[@]}" --format markdown --output "$out/pbiplint.md" 2>&1 | sed "$harmless"
        if [ -s "$out/pbiplint.md" ]; then
          echo "##vso[task.addattachment type=Distributedtask.Core.Summary;name=pbiplint]$out/pbiplint.md"
        fi
        echo "##vso[artifact.upload containerfolder=CodeAnalysisLogs;artifactname=CodeAnalysisLogs]$out/pbiplint.sarif"
      fi
      exit "$code"
    displayName: pbiplint
    env:
      PBIPLINT_VERSION: 0.2.5
      PBIPLINT_PATH: .
      PBIPLINT_FAIL_ON: error
```

It runs the pinned CLI, puts the report on the run's Extensions tab, publishes the SARIF report as
`CodeAnalysisLogs`, and fails the step on findings at or above `PBIPLINT_FAIL_ON`. What it leaves
out: build issues for each finding and the output variables, which need the task's script. Move
`PBIPLINT_VERSION` by hand when pbiplint releases.

## Agents

Works on the Microsoft-hosted Ubuntu, Windows, and macOS images, which all have Node.js and npm. A
self-hosted agent needs Node.js 20.19 or later in the 20 line, or 22.12 or later, and npm on the
PATH, and agent version 4.248.0 or later. A container job needs them in the container. npx runs with the agent's environment in the pipeline's working folder, so an `.npmrc` in
the repository, `NPM_CONFIG_REGISTRY`, and `HTTPS_PROXY` apply as npm reads them; the agent's own
proxy setting is not passed on, so behind a proxy set `HTTPS_PROXY` on the step. The task script runs on the agent's own Node.js, 24 where the agent offers it and 20
otherwise; the CLI runs on the Node.js on the PATH through npx. The linter reads only the project
that `path` names and its `pbiplint.config.json`, or the one `config` names, and makes no network
calls of its own; the one download is the pinned pbiplint package from npm.

## How it works

The task is [`task/main.mjs`](task/main.mjs) and [`task/report.mjs`](task/report.mjs), with no
dependencies: it runs the published `pbiplint` CLI at the pinned version through npx, with no shell
in between, passes the CLI's output on with any logging command in it made harmless, then writes Azure Pipelines
[logging commands](https://learn.microsoft.com/azure/devops/pipelines/scripts/logging-commands) to
its output for the build issues, the summary, the artifact, and the result. There is no bundled
code to audit.

## Links

- Rules and the web linter: https://pbiplint.com
- The CLI and its issues: https://github.com/pbiplint/pbiplint
- The GitHub Action: https://github.com/pbiplint/action
- Contributing: [CONTRIBUTING.md](CONTRIBUTING.md). Security: [SECURITY.md](SECURITY.md).

MIT licensed.
