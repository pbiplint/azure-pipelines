// Turns a pbiplint SARIF file into Azure Pipelines logging commands: build issues, output
// variables, the run summary, and the verdict. Logging commands are lines on stdout, so this needs
// no task library and no dependencies; the CLI itself never learns about Azure.

const run = (sarif) => sarif.runs?.[0] ?? {};

export function countFindings(sarif) {
  const counts = { findings: 0, errors: 0, warnings: 0, infos: 0 };
  for (const r of run(sarif).results ?? []) {
    counts.findings++;
    if (r.level === "error") counts.errors++;
    else if (r.level === "warning") counts.warnings++;
    else counts.infos++;
  }
  return counts;
}

/** Artifact URIs are percent-encoded per segment; a build issue wants the plain repository path. */
const decodePath = (uri) => uri.split("/").map(decodeURIComponent).join("/");

// The characters a terminal or a log acts on instead of printing: C0 (tab and newline included),
// DEL, C1, and the Unicode bidirectional embeddings, overrides (U+202A to U+202E), and isolates
// (U+2066 to U+2069). The same set as pbiplint core's showControls.
// eslint-disable-next-line no-control-regex -- matching control characters is the whole point
const CONTROL = /[\u0000-\u001f\u007f-\u009f‪-‮⁦-⁩]/g;

/**
 * `text` with each control character shown as a backslash, `u`, and four lowercase hex digits
 * (ESC as `\u001b`, a newline as `\u000a`), as pbiplint core's showControls writes them. Names
 * and messages come from the repository being linted, and a hostile one could hide, reorder, or
 * split what the log shows with an escape sequence, a right-to-left override, or a newline.
 */
export const showControls = (text) =>
  String(text).replace(CONTROL, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`);

/**
 * `text` with any logging command in it made harmless: `##vso[` becomes `##[vso]`, which reads the
 * same and does nothing. The agent acts on `##vso[` anywhere in a line, and repository text (a
 * name the CLI quotes, or one read back from its SARIF) can carry one.
 */
export const harmless = (text) => String(text ?? "").replace(/##vso\[/gi, "##[vso]");

/** Repository text as the task writes it to the log: control characters shown, commands harmless. */
const forLog = (text) => harmless(showControls(text));

/**
 * The agent keeps the first 10 errors and the first 10 warnings of a step as issues and only
 * counts the rest (`_maxIssueCount` in the agent's ExecutionContext.cs).
 */
export const ISSUE_CAP = 10;

/** SARIF levels as build issue types. Azure Pipelines has no notice, so info findings get none. */
const TYPE = { error: "error", warning: "warning" };

export function issues(sarif, { cap = ISSUE_CAP } = {}) {
  const rules = new Map((run(sarif).tool?.driver?.rules ?? []).map((r) => [r.id, r]));
  const taken = { error: 0, warning: 0 };
  const out = [];
  for (const r of run(sarif).results ?? []) {
    const type = TYPE[r.level];
    if (!type || taken[type] >= cap) continue;
    taken[type]++;
    const page = rules.get(r.ruleId)?.helpUri;
    const loc = r.locations?.[0]?.physicalLocation;
    out.push({
      type,
      file: loc ? forLog(decodePath(loc.artifactLocation.uri)) : undefined,
      line: loc?.region?.startLine,
      code: forLog(r.ruleId),
      // The CLI writes "object: rule name (detail)"; the agent puts the file, line, and rule id
      // in front of it, and the rule page goes after.
      message: forLog(`${r.message?.text ?? ""}${page ? `. ${page}` : ""}`),
    });
  }
  return out;
}

// Logging commands: https://learn.microsoft.com/azure/devops/pipelines/scripts/logging-commands
// The escaping is the task library's (taskcommand.ts), percent first so nothing is escaped twice.
const escapeData = (s) =>
  String(s).replace(/%/g, "%AZP25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");
const escapeProperty = (s) => escapeData(s).replace(/]/g, "%5D").replace(/;/g, "%3B");

export function command(name, props = {}, data = "") {
  const list = Object.entries(props)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `${k}=${escapeProperty(v)}`)
    .join(";");
  return `##vso[${name}${list ? ` ${list}` : ""}]${escapeData(data)}`;
}

export const issueCommand = ({ type, file, line, code, message }) =>
  command("task.logissue", { type, sourcepath: file, linenumber: line, code }, message);

export function outputCommands({ exitCode, sarifFile, counts }) {
  const values = { exitCode, sarifFile, ...counts };
  return ["exitCode", "sarifFile", "findings", "errors", "warnings", "infos"].map((name) =>
    command("task.setvariable", { variable: name, isOutput: "true" }, values[name]),
  );
}

export function summary({ markdown, counts, issued, annotate = true, exitCode = 0 }) {
  if (markdown === undefined)
    return `## pbiplint\n\npbiplint did not produce a report (exit code ${exitCode}). See the pbiplint step's log for the error.\n`;
  const footer =
    annotate && issued < counts.findings
      ? `\nBuild issues on this run show ${issued} of ${counts.findings} findings: at most ${ISSUE_CAP} errors and ${ISSUE_CAP} warnings, and no info. The full list is above.\n`
      : "";
  return markdown + footer;
}

/**
 * A file name for one step's reports, from its sarifCategory: anything but letters, digits, dots,
 * hyphens, and underscores becomes a hyphen, and so do leading dots, so the name can never
 * leave the reports folder.
 */
export function category(text) {
  const name = String(text ?? "")
    .replace(/[^A-Za-z0-9._-]/g, "-")
    .replace(/^\.+/, (dots) => "-".repeat(dots.length));
  return name || "pbiplint";
}

/**
 * The closing lines. A failing step is marked with task.complete, since the agent reads a
 * non-zero exit from a Node task as an infrastructure failure, and an error issue alone fails
 * nothing.
 */
export function verdict({ exitCode, counts, failOn }) {
  if (exitCode === 0) return [];
  if (exitCode === 1) {
    const message = `pbiplint: ${counts.errors} errors, ${counts.warnings} warnings, ${counts.infos} info. Findings at or above failOn (${failOn}) fail the step; set failOn to none to report without failing.`;
    return [message, command("task.complete", { result: "Failed" }, message)];
  }
  const message = `pbiplint could not run (exit code ${exitCode}); see the log above.`;
  return [
    command("task.logissue", { type: "error" }, message),
    command("task.complete", { result: "Failed" }, message),
  ];
}
