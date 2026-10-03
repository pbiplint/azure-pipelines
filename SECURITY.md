# Security

The task runs the published pbiplint CLI at a pinned version on the agent through npx, with no
shell between the inputs and the command, reads the files under `path`, and writes its reports to
the agent's temp folder, the run summary, and, if enabled, a build artifact. Names and messages from
the linted repository are written to the log with control characters shown as escapes and with the
logging-command escaping applied, and the CLI's own output, which quotes names from the repository,
is passed on with any logging command in it made harmless (`##vso[` becomes `##[vso]`), so a hostile
project cannot start a command of its own. The plain YAML route does the same with `sed`.

Report a vulnerability privately through GitHub:
[open a draft advisory](https://github.com/pbiplint/azure-pipelines/security/advisories/new).
Anything in the linter itself belongs in the main repository's advisories at
https://github.com/pbiplint/pbiplint/security.
