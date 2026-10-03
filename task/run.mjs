import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, win32 } from "node:path";
import { pathToFileURL } from "node:url";
import {
  category,
  command,
  countFindings,
  forAdvancedSecurity,
  issueCommand,
  issues,
  outputCommands,
  summary,
  verdict,
} from "./report.mjs";

// The pbiplint task. It runs the published pbiplint CLI at a pinned version through npx, then
// reports to the pipeline with logging commands on stdout: build issues, the run summary, the
// SARIF file as an artifact, output variables, and the verdict.

/** Input defaults, kept once, in task.json beside this script. */
export function taskDefaults() {
  const task = JSON.parse(readFileSync(new URL("./task.json", import.meta.url), "utf8"));
  return Object.fromEntries(task.inputs.map((i) => [i.name, i.defaultValue ?? ""]));
}

/** The agent passes each input as INPUT_<NAME>, upper-cased; unset or empty takes the default. */
export function inputs(env, defaults) {
  const get = (name) => {
    const value = env[`INPUT_${name.toUpperCase()}`];
    return value === undefined || value === "" ? defaults[name] : value;
  };
  const flag = (name) => String(get(name)).toLowerCase() !== "false";
  return {
    path: get("path"),
    failOn: get("failOn"),
    config: get("config"),
    pbiplintVersion: get("pbiplintVersion"),
    annotations: flag("annotations"),
    publishSarif: flag("publishSarif"),
    artifactName: get("artifactName"),
    sarifCategory: get("sarifCategory"),
  };
}

/**
 * How to run npx without a shell. Elsewhere npx is an executable. On Windows it is npx.cmd, which
 * Node will not spawn without a shell, so run npm's own npx script with Node instead: the first
 * folder on the PATH with npx.cmd and npm's script, and the node.exe beside it, or else the first
 * node.exe on the PATH, as npx.cmd itself chooses.
 */
export function findNpx(env, platform, exists = existsSync) {
  if (platform !== "win32") return { command: "npx", prefix: [] };
  const dirs = (env.PATH ?? env.Path ?? "").split(";").filter(Boolean);
  const dir = dirs.find((d) => exists(win32.join(d, "npx.cmd")) && exists(win32.join(d, NPX_CLI)));
  if (!dir) return undefined;
  const nodeDir = [dir, ...dirs].find((d) => exists(win32.join(d, "node.exe")));
  if (!nodeDir) return undefined;
  return { command: win32.join(nodeDir, "node.exe"), prefix: [win32.join(dir, NPX_CLI)] };
}

const NPX_CLI = "node_modules/npm/bin/npx-cli.js";

const nonEmpty = (file) => existsSync(file) && statSync(file).size > 0;

function readSarif(file) {
  if (!nonEmpty(file)) return undefined;
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return undefined;
  }
}

export function main({ env, platform, stdout, spawn = spawnSync, defaults = taskDefaults() }) {
  const input = inputs(env, defaults);
  const cwd = env.SYSTEM_DEFAULTWORKINGDIRECTORY || process.cwd();
  const folder = join(env.AGENT_TEMPDIRECTORY || tmpdir(), "pbiplint");
  const name = category(input.sarifCategory);
  const sarifFile = join(folder, `${name}.sarif`);
  const markdownFile = join(folder, `${name}.md`);
  const summaryFile = join(folder, `${name}.summary.md`);
  mkdirSync(folder, { recursive: true });
  for (const file of [sarifFile, markdownFile, summaryFile]) rmSync(file, { force: true });

  const args = [input.path, "--fail-on", input.failOn];
  if (input.config) args.push("--config", input.config);
  const npx = findNpx(env, platform);
  let exitCode;
  if (!npx) {
    stdout("pbiplint: npx not found. Node.js and npm must be on the PATH of the agent.");
    exitCode = 2;
  } else {
    const lint = (format, output) =>
      spawn(
        npx.command,
        [
          ...npx.prefix,
          "--yes",
          `pbiplint@${input.pbiplintVersion}`,
          ...args,
          "--format",
          format,
          "--output",
          output,
        ],
        { cwd, env, stdio: ["ignore", "inherit", "inherit"] },
      );
    exitCode = lint("sarif", sarifFile).status ?? 2;
    // pbiplint writes the SARIF file on every run it completes, so a non-zero exit with none means
    // it could not run, for example because npx could not install the version asked for.
    if (exitCode !== 0 && !nonEmpty(sarifFile)) exitCode = 2;
    // The same run again as Markdown for the summary. A usage error would only repeat.
    if (exitCode !== 2) lint("markdown", markdownFile);
  }

  const sarif = readSarif(sarifFile);
  // With no SARIF to read there is no verdict on the project, whatever the exit code said.
  if (!sarif) exitCode = 2;
  else writeFileSync(sarifFile, `${JSON.stringify(forAdvancedSecurity(sarif), null, 2)}\n`);
  const counts = sarif ? countFindings(sarif) : { findings: 0, errors: 0, warnings: 0, infos: 0 };
  const list = sarif && input.annotations ? issues(sarif) : [];
  for (const issue of list) stdout(issueCommand(issue));

  const markdown = sarif && nonEmpty(markdownFile) ? readFileSync(markdownFile, "utf8") : undefined;
  writeFileSync(
    summaryFile,
    summary({ markdown, counts, issued: list.length, annotate: input.annotations, exitCode }),
  );
  stdout(command("task.uploadsummary", {}, summaryFile));
  if (input.publishSarif && sarif)
    stdout(
      command(
        "artifact.upload",
        { containerfolder: input.artifactName, artifactname: input.artifactName },
        sarifFile,
      ),
    );
  for (const line of outputCommands({ exitCode, sarifFile, counts })) stdout(line);
  for (const line of verdict({ exitCode, counts, failOn: input.failOn })) stdout(line);
  return exitCode;
}

// The agent runs `node run.mjs`. The script always exits 0: the agent reads a non-zero exit from a
// Node task as an infrastructure failure, so the verdict goes out as task.complete instead.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main({ env: process.env, platform: process.platform, stdout: console.log });
}
