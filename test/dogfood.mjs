import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// The task and the plain YAML route run for real on a sample project, with the environment the
// agent would give them set by hand: the real CLI from npm, the real npx, no Azure. CI runs this on
// Ubuntu and Windows; locally, `npm run dogfood -- <path to examples/messy-sales>`.
//
//   node test/dogfood.mjs <sample path, relative to the current folder>
//
// PBIPLINT_DOGFOOD_VERSION overrides the CLI version (an npm spec, so `file:<tarball>` runs a
// local build). PBIPLINT_BASH names the bash to run the plain route with (Git Bash on Windows).

const sample = process.argv[2];
if (!sample) {
  console.error("Usage: node test/dogfood.mjs <sample path>");
  process.exit(2);
}
const root = fileURLToPath(new URL("..", import.meta.url));
const version = process.env.PBIPLINT_DOGFOOD_VERSION;
const failures = [];
const check = (ok, what) => {
  console.log(`${ok ? "ok  " : "FAIL"} ${what}`);
  if (!ok) failures.push(what);
};

/** Runs the task script as the agent would and returns its logging commands and outputs. */
function task(name, env, path = sample) {
  const temp = mkdtempSync(join(tmpdir(), "pbiplint-dogfood-"));
  const r = spawnSync(process.execPath, [join(root, "task", "run.mjs")], {
    encoding: "utf8",
    env: {
      ...process.env,
      AGENT_TEMPDIRECTORY: temp,
      SYSTEM_DEFAULTWORKINGDIRECTORY: process.cwd(),
      INPUT_PATH: path,
      ...(version ? { INPUT_PBIPLINTVERSION: version } : {}),
      ...env,
    },
  });
  const lines = r.stdout.split(/\r?\n/);
  const output = (variable) =>
    lines
      .find((l) => l.startsWith(`##vso[task.setvariable variable=${variable};`))
      ?.replace(/^.*\]/, "");
  const result = {
    status: r.status,
    lines,
    all: `${r.stdout}\n${r.stderr}`,
    failed: lines.some((l) => l.startsWith("##vso[task.complete result=Failed]")),
    exitCode: output("exitCode"),
    errors: Number(output("errors")),
    warnings: Number(output("warnings")),
    findings: Number(output("findings")),
    issues: lines.filter((l) => l.startsWith("##vso[task.logissue")).length,
    summary: lines
      .find((l) => l.startsWith("##vso[task.addattachment type=Distributedtask.Core.Summary;"))
      ?.replace(/^.*?\]/, ""),
    artifact: lines.some((l) => l.startsWith("##vso[artifact.upload ")),
  };
  console.log(
    `${name}: script exit ${r.status}, exitCode ${result.exitCode}, ${result.findings} findings, ${result.issues} build issues, failed ${result.failed}`,
  );
  return result;
}

// First, as in the Action's dogfood: a version npm does not have.
const missing = task("missing version", { INPUT_PBIPLINTVERSION: "0.0.0-not-published" });
check(missing.status === 0, "missing version: the script exits 0");
check(missing.exitCode === "2" && missing.failed, "missing version: exit code 2, step failed");
check(!missing.artifact, "missing version: no artifact");

const report = task("report without failing", { INPUT_FAILON: "none" });
check(report.status === 0, "report: the script exits 0");
check(report.exitCode === "0" && !report.failed, "report: exit code 0, step not failed");
check(report.errors > 0, "report: the sample has errors");
check(
  report.issues === Math.min(report.errors, 10) + Math.min(report.warnings, 10),
  "report: at most 10 build issues per severity",
);
check(
  Boolean(report.summary) && readFileSync(report.summary, "utf8").startsWith("# pbiplint report"),
  "report: the summary file holds the Markdown report",
);
check(report.artifact, "report: the SARIF file is published");

const gate = task("gate on findings", {});
check(gate.status === 0, "gate: the script exits 0");
check(gate.exitCode === "1" && gate.failed, "gate: exit code 1, step failed");

// The plain YAML route: its script, taken from examples/plain.yml, with the step's env.
const yaml = readFileSync(join(root, "examples", "plain.yml"), "utf8").split(/\r?\n/);
const start = yaml.findIndex((l) => l.trim() === "- bash: |") + 1;
const end = yaml.findIndex((l, i) => i >= start && !l.startsWith("      ") && l.trim() !== "");
const script = yaml
  .slice(start, end)
  .map((l) => l.slice(6))
  .join("\n");
function plainRoute(path) {
  const temp = mkdtempSync(join(tmpdir(), "pbiplint-plain-"));
  const scriptFile = join(temp, "plain.sh");
  writeFileSync(scriptFile, `${script}\n`);
  const r = spawnSync(process.env.PBIPLINT_BASH || "bash", ["--noprofile", "--norc", scriptFile], {
    encoding: "utf8",
    env: {
      ...process.env,
      AGENT_TEMPDIRECTORY: temp,
      PBIPLINT_VERSION: version ?? yamlValue("PBIPLINT_VERSION"),
      PBIPLINT_PATH: path,
      PBIPLINT_FAIL_ON: "error",
    },
  });
  return { ...r, temp };
}
const plain = plainRoute(sample);
const temp = plain.temp;
console.log(`plain route: exit ${plain.status}`);
check(plain.status === 1, "plain route: exits 1 on the sample's errors");
check(existsSync(join(temp, "pbiplint", "pbiplint.sarif")), "plain route: SARIF written");
check(
  existsSync(join(temp, "pbiplint", "pbiplint.md")) &&
    plain.stdout.includes(
      "##vso[task.addattachment type=Distributedtask.Core.Summary;name=pbiplint]",
    ),
  "plain route: summary written and uploaded",
);
check(
  plain.stdout.includes(
    "##vso[artifact.upload containerfolder=CodeAnalysisLogs;artifactname=CodeAnalysisLogs]",
  ),
  "plain route: SARIF published",
);

// A hostile repository: its config names a "rule" that is a logging command, which the CLI quotes
// when it refuses the name. Neither route may let it through.
const hostileDir = mkdtempSync(join(tmpdir(), "pbiplint-hostile-"));
const hostile = join(hostileDir, "messy-sales");
cpSync(sample, hostile, { recursive: true });
writeFileSync(
  join(hostile, "pbiplint.config.json"),
  JSON.stringify({ rules: { "##vso[task.complete result=Succeeded;done=true]": "off" } }),
);
const attack = /##vso\[task\.complete result=Succeeded/i;
const taskHostile = task("hostile config", {}, hostile);
check(taskHostile.all.includes("##[vso]task.complete"), "hostile: the CLI quoted the name");
check(!attack.test(taskHostile.all), "hostile: the task let no command through");
check(taskHostile.failed, "hostile: the task's step failed");
const plainHostile = plainRoute(hostile);
check(
  !attack.test(`${plainHostile.stdout}\n${plainHostile.stderr}`),
  "hostile: the plain route let no command through",
);
check(plainHostile.status !== 0, "hostile: the plain route's step failed");

function yamlValue(name) {
  return yaml
    .find((l) => l.trim().startsWith(`${name}:`))
    .split(":")[1]
    .trim();
}

if (failures.length) {
  console.error(`\n${failures.length} checks failed.`);
  process.exit(1);
}
console.log("\nAll checks passed.");
