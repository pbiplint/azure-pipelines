import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, onTestFinished, test } from "vitest";
import { findNpx, inputs, main } from "../task/run.mjs";

const SARIF = readFileSync(new URL("./fixtures/messy-sales.sarif", import.meta.url), "utf8");

const DEFAULTS = {
  path: ".",
  failOn: "error",
  config: "",
  pbiplintVersion: "0.2.3",
  annotations: "true",
  publishSarif: "true",
  artifactName: "CodeAnalysisLogs",
  sarifCategory: "pbiplint",
};

function tempDir() {
  const dir = mkdtempSync(join(tmpdir(), "pbiplint-task-"));
  onTestFinished(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

/**
 * Runs main with a stand-in for npx: it records each call and, for the SARIF run, writes `sarif`
 * (unless null) and returns `status`; the Markdown run writes a small report.
 */
function lint({ env = {}, status = 0, sarif = SARIF, spawnResult, platform = "linux" } = {}) {
  const temp = tempDir();
  const calls = [];
  const lines = [];
  const spawn = (cmd, args, options) => {
    calls.push({ cmd, args, options });
    if (spawnResult) return spawnResult;
    const output = args[args.indexOf("--output") + 1];
    const format = args[args.indexOf("--format") + 1];
    if (format === "sarif" && sarif !== null) writeFileSync(output, sarif);
    if (format === "markdown") writeFileSync(output, "# pbiplint report\n");
    return { status };
  };
  const code = main({
    env: { AGENT_TEMPDIRECTORY: temp, SYSTEM_DEFAULTWORKINGDIRECTORY: "/repo", ...env },
    platform,
    stdout: (line) => lines.push(line),
    spawn,
    defaults: DEFAULTS,
  });
  const folder = join(temp, "pbiplint");
  return { code, calls, lines, folder, out: lines.join("\n") };
}

const logissues = (lines) => lines.filter((l) => l.startsWith("##vso[task.logissue"));

describe("inputs", () => {
  test("takes each input from its INPUT_ variable", () => {
    const env = {
      INPUT_PATH: "Sales.pbip",
      INPUT_FAILON: "warning",
      INPUT_CONFIG: "lint.json",
      INPUT_PBIPLINTVERSION: "0.3.0",
      INPUT_ANNOTATIONS: "false",
      INPUT_PUBLISHSARIF: "False",
      INPUT_ARTIFACTNAME: "Lint",
      INPUT_SARIFCATEGORY: "sales",
    };
    expect(inputs(env, DEFAULTS)).toEqual({
      path: "Sales.pbip",
      failOn: "warning",
      config: "lint.json",
      pbiplintVersion: "0.3.0",
      annotations: false,
      publishSarif: false,
      artifactName: "Lint",
      sarifCategory: "sales",
    });
  });

  test("an unset or empty input takes the task's default", () => {
    expect(inputs({ INPUT_PATH: "" }, DEFAULTS)).toEqual({
      path: ".",
      failOn: "error",
      config: "",
      pbiplintVersion: "0.2.3",
      annotations: true,
      publishSarif: true,
      artifactName: "CodeAnalysisLogs",
      sarifCategory: "pbiplint",
    });
  });
});

describe("findNpx", () => {
  const exists = (paths) => (p) => paths.includes(p.replace(/\\/g, "/"));

  test("runs npx directly outside Windows", () => {
    expect(findNpx({}, "linux")).toEqual({ command: "npx", prefix: [] });
    expect(findNpx({}, "darwin")).toEqual({ command: "npx", prefix: [] });
  });

  test("on Windows, runs npm's npx script with the node.exe beside it", () => {
    const env = { PATH: "C:/agent/externals/node20_1/bin;C:/Program Files/nodejs" };
    const found = findNpx(
      env,
      "win32",
      exists([
        "C:/agent/externals/node20_1/bin/node.exe",
        "C:/Program Files/nodejs/npx.cmd",
        "C:/Program Files/nodejs/node.exe",
        "C:/Program Files/nodejs/node_modules/npm/bin/npx-cli.js",
      ]),
    );
    expect(found.command.replace(/\\/g, "/")).toBe("C:/Program Files/nodejs/node.exe");
    expect(found.prefix.map((p) => p.replace(/\\/g, "/"))).toEqual([
      "C:/Program Files/nodejs/node_modules/npm/bin/npx-cli.js",
    ]);
  });

  test("on Windows, an npx in npm's global folder runs with the first node.exe on the PATH", () => {
    const env = { Path: "C:/npm/prefix;C:/Program Files/nodejs" };
    const found = findNpx(
      env,
      "win32",
      exists([
        "C:/npm/prefix/npx.cmd",
        "C:/npm/prefix/node_modules/npm/bin/npx-cli.js",
        "C:/Program Files/nodejs/node.exe",
      ]),
    );
    expect(found.command.replace(/\\/g, "/")).toBe("C:/Program Files/nodejs/node.exe");
    expect(found.prefix[0].replace(/\\/g, "/")).toBe(
      "C:/npm/prefix/node_modules/npm/bin/npx-cli.js",
    );
  });

  test("on Windows, finds nothing without npm's npx script", () => {
    expect(
      findNpx({ PATH: "C:/tools" }, "win32", exists(["C:/tools/npx.cmd", "C:/tools/node.exe"])),
    ).toBeUndefined();
    expect(findNpx({}, "win32", () => false)).toBeUndefined();
  });
});

describe("main", () => {
  test("runs the pinned CLI with no shell, in the repository, for SARIF and then Markdown", () => {
    const { calls, folder } = lint({ env: { INPUT_PATH: "Sales.pbip" } });
    expect(calls).toHaveLength(2);
    expect(calls[0].cmd).toBe("npx");
    expect(calls[0].args).toEqual([
      "--yes",
      "pbiplint@0.2.3",
      "Sales.pbip",
      "--fail-on",
      "error",
      "--format",
      "sarif",
      "--output",
      join(folder, "pbiplint.sarif"),
    ]);
    expect(calls[1].args.slice(5)).toEqual([
      "--format",
      "markdown",
      "--output",
      join(folder, "pbiplint.md"),
    ]);
    for (const { options } of calls) {
      expect(options.cwd).toBe("/repo");
      expect(options.shell).toBeUndefined();
      expect(options.stdio).toEqual(["ignore", "inherit", "inherit"]);
    }
  });

  test("passes --config only when the input is set", () => {
    const { calls } = lint({ env: { INPUT_CONFIG: "lint.json", INPUT_FAILON: "warning" } });
    expect(calls[0].args.slice(2, 7)).toEqual([
      ".",
      "--fail-on",
      "warning",
      "--config",
      "lint.json",
    ]);
  });

  test("a run with no findings at or above failOn passes and reports everything", () => {
    const { code, lines, out, folder } = lint({ env: { INPUT_FAILON: "none" } });
    expect(code).toBe(0);
    expect(logissues(lines)).toHaveLength(20);
    const summaryFile = join(folder, "pbiplint.summary.md");
    expect(out).toContain(`##vso[task.uploadsummary]${summaryFile}`);
    expect(readFileSync(summaryFile, "utf8")).toMatch(
      /^# pbiplint report\n\nBuild issues on this run show 20 of 266 findings/,
    );
    expect(out).toContain(
      `##vso[artifact.upload containerfolder=CodeAnalysisLogs;artifactname=CodeAnalysisLogs]${join(folder, "pbiplint.sarif")}`,
    );
    expect(out).toContain("##vso[task.setvariable variable=exitCode;isOutput=true]0");
    expect(out).toContain("##vso[task.setvariable variable=findings;isOutput=true]266");
    expect(out).not.toContain("task.complete");
  });

  test("findings at or above failOn fail the step after the report is out", () => {
    const { code, lines } = lint({ status: 1 });
    expect(code).toBe(1);
    expect(lines.at(-1)).toMatch(/^##vso\[task\.complete result=Failed\]pbiplint: 19 errors/);
    expect(lines.findIndex((l) => l.startsWith("##vso[task.uploadsummary"))).toBeLessThan(
      lines.length - 2,
    );
  });

  test("annotations off: no build issues, and no note about them in the summary", () => {
    const { lines, folder } = lint({ env: { INPUT_ANNOTATIONS: "false" } });
    expect(logissues(lines)).toHaveLength(0);
    expect(readFileSync(join(folder, "pbiplint.summary.md"), "utf8")).toBe("# pbiplint report\n");
  });

  test("publishSarif off: no artifact", () => {
    const { out } = lint({ env: { INPUT_PUBLISHSARIF: "false" } });
    expect(out).not.toContain("artifact.upload");
  });

  test("the artifact name and the category name the artifact and the files", () => {
    const { out, folder } = lint({
      env: { INPUT_ARTIFACTNAME: "Lint", INPUT_SARIFCATEGORY: "pbiplint/sales" },
    });
    expect(out).toContain(
      `##vso[artifact.upload containerfolder=Lint;artifactname=Lint]${join(folder, "pbiplint-sales.sarif")}`,
    );
    expect(existsSync(join(folder, "pbiplint-sales.summary.md"))).toBe(true);
  });

  test("a non-zero exit with no SARIF file means pbiplint could not run", () => {
    const { code, calls, out, folder } = lint({ status: 1, sarif: null });
    expect(code).toBe(2);
    expect(calls).toHaveLength(1);
    expect(out).not.toContain("artifact.upload");
    expect(out).toContain("##vso[task.setvariable variable=exitCode;isOutput=true]2");
    expect(out).toMatch(/##vso\[task\.complete result=Failed\]pbiplint could not run/);
    expect(readFileSync(join(folder, "pbiplint.summary.md"), "utf8")).toContain(
      "did not produce a report (exit code 2)",
    );
  });

  test("an empty SARIF file counts as none", () => {
    expect(lint({ status: 1, sarif: "" }).code).toBe(2);
  });

  test("a SARIF file that is not JSON means no report", () => {
    const { code, out } = lint({ status: 1, sarif: "{ not json" });
    expect(code).toBe(2);
    expect(out).not.toContain("artifact.upload");
    expect(out).toContain("variable=findings;isOutput=true]0");
  });

  test("npx failing to start means pbiplint could not run", () => {
    const { code } = lint({ spawnResult: { error: new Error("ENOENT"), status: null } });
    expect(code).toBe(2);
  });

  test("no npx on a Windows PATH: exit code 2, a message, and nothing spawned", () => {
    const { code, calls, out } = lint({ platform: "win32", env: { PATH: "" } });
    expect(code).toBe(2);
    expect(calls).toHaveLength(0);
    expect(out).toContain("Node.js and npm must be on the PATH");
  });

  test("reports left by an earlier step with the same category are removed first", () => {
    const temp = tempDir();
    const folder = join(temp, "pbiplint");
    main({
      env: { AGENT_TEMPDIRECTORY: temp },
      platform: "linux",
      stdout: () => {},
      spawn: (_c, args) => {
        writeFileSync(args[args.indexOf("--output") + 1], SARIF);
        return { status: 0 };
      },
      defaults: DEFAULTS,
    });
    const lines = [];
    const code = main({
      env: { AGENT_TEMPDIRECTORY: temp },
      platform: "linux",
      stdout: (l) => lines.push(l),
      spawn: () => ({ status: 1 }),
      defaults: DEFAULTS,
    });
    expect(code).toBe(2);
    expect(existsSync(join(folder, "pbiplint.md"))).toBe(false);
  });
});
