import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import {
  ISSUE_CAP,
  category,
  command,
  countFindings,
  issueCommand,
  issues,
  outputCommands,
  showControls,
  summary,
  verdict,
} from "../task/report.mjs";

const fixture = JSON.parse(
  readFileSync(new URL("./fixtures/messy-sales.sarif", import.meta.url), "utf8"),
);

/** A one-run SARIF document with the given rules and results, shaped like pbiplint's. */
function sarif(rules, results) {
  return { version: "2.1.0", runs: [{ tool: { driver: { name: "pbiplint", rules } }, results }] };
}

const RULE = {
  id: "PROVIDE_FORMAT_STRING_FOR_MEASURES",
  name: "Provide format string for measures",
  helpUri: "https://pbiplint.com/rules/provide-format-string-for-measures",
};

// eslint-disable-next-line no-control-regex -- finding control characters is what this is for
const RAW_CONTROL = /[\u0000-\u001f\u007f-\u009f‪-‮⁦-⁩]/;

function result(level, text, uri, line) {
  return {
    ruleId: RULE.id,
    ruleIndex: 0,
    level,
    message: { text },
    ...(uri
      ? {
          locations: [
            { physicalLocation: { artifactLocation: { uri }, region: { startLine: line } } },
          ],
        }
      : {}),
  };
}

const COUNTS = { findings: 266, errors: 19, warnings: 77, infos: 170 };

describe("countFindings", () => {
  test("counts every result by level", () => {
    expect(countFindings(fixture)).toEqual(COUNTS);
  });

  test("an empty run counts to zero", () => {
    expect(countFindings(sarif([], []))).toEqual({ findings: 0, errors: 0, warnings: 0, infos: 0 });
  });
});

describe("issues", () => {
  test("maps a result to a build issue with its file, line, rule id, and rule page", () => {
    const doc = sarif(
      [RULE],
      [
        result(
          "error",
          "[Total Sales]: Provide format string for measures",
          "Sales.SemanticModel/definition/tables/Sales.tmdl",
          112,
        ),
      ],
    );
    expect(issues(doc)).toEqual([
      {
        type: "error",
        file: "Sales.SemanticModel/definition/tables/Sales.tmdl",
        line: 112,
        code: "PROVIDE_FORMAT_STRING_FOR_MEASURES",
        message:
          "[Total Sales]: Provide format string for measures. https://pbiplint.com/rules/provide-format-string-for-measures",
      },
    ]);
  });

  test("leaves the rule page out when the rule has none", () => {
    const doc = sarif([{ id: RULE.id, name: RULE.name }], [result("warning", "a: x", "a.tmdl", 1)]);
    expect(issues(doc)[0].message).toBe("a: x");
  });

  test("a finding with no location has no file or line", () => {
    const [issue] = issues(sarif([RULE], [result("error", "model: x")]));
    expect(issue.file).toBeUndefined();
    expect(issue.line).toBeUndefined();
  });

  test("skips info findings, since Azure Pipelines has no notice level", () => {
    const doc = sarif(
      [RULE],
      [result("note", "a: x", "a.tmdl", 1), result("warning", "b: x", "a.tmdl", 2)],
    );
    expect(issues(doc).map((i) => i.type)).toEqual(["warning"]);
  });

  test("keeps the first 10 errors and the first 10 warnings, as the agent shows no more", () => {
    const list = issues(fixture);
    expect(ISSUE_CAP).toBe(10);
    expect(list.filter((i) => i.type === "error")).toHaveLength(10);
    expect(list.filter((i) => i.type === "warning")).toHaveLength(10);
    expect(list).toHaveLength(20);
  });

  test("the fixture's first issue names its decoded file", () => {
    expect(issues(fixture)[0]).toMatchObject({
      type: "error",
      file: "examples/messy-sales/Messy Sales Demo.Report/definition/pages/3cea48e58036b1654474/visuals/6500e9c3f9d74f2958c7/visual.json",
      code: "BROKEN_ACTION_TARGET",
    });
  });

  test("decodes percent-encoded artifact URIs into repository paths", () => {
    const doc = sarif(
      [RULE],
      [result("error", "a: x", "My%20Model.SemanticModel/tables/Sales%3BQ1%2525.tmdl", 7)],
    );
    expect(issues(doc)[0].file).toBe("My Model.SemanticModel/tables/Sales;Q1%25.tmdl");
  });

  test("shows control characters in names and messages instead of passing them on", () => {
    const doc = sarif(
      [RULE],
      [result("error", "[Sales\u001b[2J‮\n\tTotal]: x (a\r\nb)", "a\u001b.tmdl", 1)],
    );
    const [issue] = issues(doc);
    expect(issue.message).not.toMatch(RAW_CONTROL);
    expect(issue.message).toContain("\\u001b[2J\\u202e\\u000a\\u0009Total");
    expect(issue.file).not.toMatch(RAW_CONTROL);
  });

  test("rewrites a logging command in repository text, which a reader of the SARIF gets raw", () => {
    const doc = sarif(
      [RULE],
      [result("error", "[##vso[task.complete result=Succeeded]]: x", "##VSO[a].tmdl", 1)],
    );
    const [issue] = issues(doc);
    expect(issue.message).toBe(
      "[##[vso]task.complete result=Succeeded]]: x. https://pbiplint.com/rules/provide-format-string-for-measures",
    );
    expect(issue.file).toBe("##[vso]a].tmdl");
  });
});

describe("showControls", () => {
  test("writes each control character as a \\u escape", () => {
    expect(showControls("a\u0000b\u007fc\u009fd⁦e")).toBe("a\\u0000b\\u007fc\\u009fd\\u2066e");
  });
});

describe("command", () => {
  test("joins properties with semicolons", () => {
    expect(command("task.logissue", { type: "error", code: "X" }, "msg")).toBe(
      "##vso[task.logissue type=error;code=X]msg",
    );
  });

  test("a command with no properties has no space before the bracket", () => {
    expect(command("task.uploadsummary", {}, "/tmp/a.md")).toBe(
      "##vso[task.uploadsummary]/tmp/a.md",
    );
  });

  test("drops undefined properties", () => {
    expect(command("task.logissue", { type: "warning", sourcepath: undefined }, "m")).toBe(
      "##vso[task.logissue type=warning]m",
    );
  });

  test("escapes percent first, then carriage returns and newlines, in the data", () => {
    expect(command("x", {}, "100% a\r\nb ]; c")).toBe("##vso[x]100%AZP25 a%0D%0Ab ]; c");
  });

  test("escapes semicolons and closing brackets in property values too", () => {
    expect(command("x", { sourcepath: "a;b]c%d\ne" }, "")).toBe(
      "##vso[x sourcepath=a%3Bb%5Dc%AZP25d%0Ae]",
    );
  });

  test("a value cannot start a second command", () => {
    const line = command(
      "task.logissue",
      { type: "error" },
      "x\n##vso[task.complete result=Failed]",
    );
    expect(line.split("\n")).toHaveLength(1);
    expect(line.match(/##vso\[/g)).toHaveLength(2);
    expect(line.startsWith("##vso[task.logissue")).toBe(true);
  });
});

describe("issueCommand", () => {
  test("writes task.logissue with the type, file, line, and rule id", () => {
    expect(
      issueCommand({ type: "error", file: "My Model/a;b.tmdl", line: 3, code: "R", message: "m" }),
    ).toBe("##vso[task.logissue type=error;sourcepath=My Model/a%3Bb.tmdl;linenumber=3;code=R]m");
  });

  test("leaves out the file and line of a finding with none", () => {
    expect(issueCommand({ type: "warning", code: "R", message: "m" })).toBe(
      "##vso[task.logissue type=warning;code=R]m",
    );
  });
});

describe("outputCommands", () => {
  test("sets each output variable for later steps", () => {
    expect(outputCommands({ exitCode: 1, sarifFile: "/t/pbiplint.sarif", counts: COUNTS })).toEqual(
      [
        "##vso[task.setvariable variable=exitCode;isOutput=true]1",
        "##vso[task.setvariable variable=sarifFile;isOutput=true]/t/pbiplint.sarif",
        "##vso[task.setvariable variable=findings;isOutput=true]266",
        "##vso[task.setvariable variable=errors;isOutput=true]19",
        "##vso[task.setvariable variable=warnings;isOutput=true]77",
        "##vso[task.setvariable variable=infos;isOutput=true]170",
      ],
    );
  });
});

describe("summary", () => {
  test("adds a line saying how many findings the build issues show", () => {
    expect(summary({ markdown: "# pbiplint report\n", counts: COUNTS, issued: 20 })).toBe(
      "# pbiplint report\n\nBuild issues on this run show 20 of 266 findings: at most 10 errors and 10 warnings, and no info. The full list is above.\n",
    );
  });

  test("adds nothing when every finding is a build issue", () => {
    const counts = { findings: 2, errors: 1, warnings: 1, infos: 0 };
    expect(summary({ markdown: "# r\n", counts, issued: 2 })).toBe("# r\n");
  });

  test("adds nothing when build issues are off", () => {
    expect(summary({ markdown: "# r\n", counts: COUNTS, issued: 0, annotate: false })).toBe(
      "# r\n",
    );
  });

  test("says so when there is no report", () => {
    expect(summary({ counts: COUNTS, issued: 0, exitCode: 2 })).toBe(
      "## pbiplint\n\npbiplint did not produce a report (exit code 2). See the pbiplint step's log for the error.\n",
    );
  });
});

describe("category", () => {
  test("keeps a plain name", () => {
    expect(category("pbiplint")).toBe("pbiplint");
  });

  test("turns path separators and other characters into hyphens", () => {
    expect(category("pbiplint/sales")).toBe("pbiplint-sales");
    expect(category("a\\b c:d")).toBe("a-b-c-d");
  });

  test("a name of dots cannot leave the folder", () => {
    expect(category("..")).toBe("--");
    expect(category(".hidden")).toBe("-hidden");
  });

  test("an empty name falls back to pbiplint", () => {
    expect(category("")).toBe("pbiplint");
    expect(category(undefined)).toBe("pbiplint");
  });
});

describe("verdict", () => {
  test("says nothing when the run passes", () => {
    expect(verdict({ exitCode: 0, counts: COUNTS, failOn: "none" })).toEqual([]);
  });

  test("fails the step on findings at or above failOn, and says how to stop it", () => {
    const message =
      "pbiplint: 19 errors, 77 warnings, 170 info. Findings at or above failOn (error) fail the step; set failOn to none to report without failing.";
    expect(verdict({ exitCode: 1, counts: COUNTS, failOn: "error" })).toEqual([
      message,
      `##vso[task.complete result=Failed]${message}`,
    ]);
  });

  test("fails the step with an error issue when pbiplint could not run", () => {
    const message = "pbiplint could not run (exit code 2); see the log above.";
    expect(verdict({ exitCode: 2, counts: COUNTS, failOn: "error" })).toEqual([
      `##vso[task.logissue type=error]${message}`,
      `##vso[task.complete result=Failed]${message}`,
    ]);
  });
});
