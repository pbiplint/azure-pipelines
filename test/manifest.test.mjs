import { existsSync, readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { outputCommands } from "../task/report.mjs";
import { inputs, taskDefaults } from "../task/run.mjs";

const read = (path) => JSON.parse(readFileSync(new URL(`../${path}`, import.meta.url), "utf8"));
const task = read("task/task.json");
const extension = read("vss-extension.json");
const pkg = read("package.json");

/** task-lib's tasks.schema.json: input and output variable names. */
const NAME = /^[A-Za-z][A-Za-z0-9]*$/;

describe("task.json", () => {
  test("declares exactly the inputs run.mjs reads", () => {
    const read = Object.keys(inputs({}, taskDefaults()));
    expect(task.inputs.map((i) => i.name).sort()).toEqual(read.sort());
  });

  test("every input has a default run.mjs can use", () => {
    expect(inputs({}, taskDefaults())).toEqual({
      path: ".",
      failOn: "error",
      config: "",
      pbiplintVersion: expect.stringMatching(/^\d+\.\d+\.\d+$/),
      annotations: true,
      publishSarif: true,
      artifactName: "CodeAnalysisLogs",
      sarifCategory: "pbiplint",
    });
  });

  test("input and output variable names fit the schema", () => {
    for (const { name } of [...task.inputs, ...task.outputVariables]) expect(name).toMatch(NAME);
  });

  test("declares exactly the output variables the task sets", () => {
    const set = outputCommands({
      exitCode: 0,
      sarifFile: "",
      counts: { findings: 0, errors: 0, warnings: 0, infos: 0 },
    }).map((line) => line.match(/variable=(\w+);/)[1]);
    expect(task.outputVariables.map((v) => v.name)).toEqual(set);
  });

  test("failOn offers the CLI's four levels", () => {
    const failOn = task.inputs.find((i) => i.name === "failOn");
    expect(failOn.type).toBe("pickList");
    expect(Object.keys(failOn.options)).toEqual(["error", "warning", "info", "none"]);
  });

  test("runs on Node 24 and falls back to Node 20 on older agents", () => {
    expect(task.execution).toEqual({
      Node24: { target: "run.mjs" },
      Node20_1: { target: "run.mjs" },
    });
    expect(existsSync(new URL("../task/run.mjs", import.meta.url))).toBe(true);
    expect(task.minimumAgentVersion).toBe("4.248.0");
  });
});

describe("versions", () => {
  test("the task, the extension, and package.json carry one version", () => {
    const { Major, Minor, Patch } = task.version;
    expect(extension.version).toBe(`${Major}.${Minor}.${Patch}`);
    expect(pkg.version).toBe(extension.version);
  });
});

describe("vss-extension.json", () => {
  test("contributes the task folder, which it packs", () => {
    const [contribution] = extension.contributions;
    expect(contribution.type).toBe("ms.vss-distributed-task.task");
    expect(contribution.targets).toEqual(["ms.vss-distributed-task.tasks"]);
    expect(extension.files.map((f) => f.path)).toContain(contribution.properties.name);
    expect(
      existsSync(new URL(`../${contribution.properties.name}/task.json`, import.meta.url)),
    ).toBe(true);
  });

  test("stays private until a release makes it public", () => {
    expect(extension.public).toBe(false);
  });

  test("its icon and the task's exist", () => {
    expect(existsSync(new URL(`../${extension.icons.default}`, import.meta.url))).toBe(true);
    expect(existsSync(new URL("../task/icon.png", import.meta.url))).toBe(true);
  });
});

describe("the pinned version and the plain route", () => {
  const readme = readFileSync(new URL("../README.md", import.meta.url), "utf8");
  const plain = readFileSync(new URL("../examples/plain.yml", import.meta.url), "utf8");
  const pinned = taskDefaults().pbiplintVersion;

  test("the README's inputs table and the plain route pin the task's version", () => {
    expect(readme).toContain(`| \`pbiplintVersion\` | \`${pinned}\``);
    expect(plain).toContain(`PBIPLINT_VERSION: ${pinned}\n`);
    expect(readme).toContain(`PBIPLINT_VERSION: ${pinned}\n`);
  });

  test("the README's copy of the plain route has every line of examples/plain.yml's step", () => {
    const lines = plain
      .slice(plain.indexOf("steps:"))
      .split("\n")
      .filter((l) => l.trim() && !l.trim().startsWith("#"));
    for (const line of lines) expect(readme).toContain(line);
  });
});
