import { describe, expect, it } from "vitest";

import { parseGenerationOutput, parseReviewOutput } from "../core/protocol";

describe("protocol parsing", () => {
  it("accepts a valid review payload", () => {
    const parsed = parseReviewOutput(
      JSON.stringify({
        type: "review",
        reviewer: "agent_b",
        target: "agent_a",
        issues: [
          {
            severity: "high",
            file: "src/auth.js",
            problem: "Hardcoded secret",
            fix: "Use env variable"
          }
        ],
        summary: "Needs fixes"
      })
    );

    expect(parsed.reviewer).toBe("agent_b");
    expect(parsed.issues).toHaveLength(1);
    expect(parsed.issues[0]?.id).toBe("src/auth.js|hardcoded secret");
  });

  it("accepts a valid generation payload", () => {
    const parsed = parseGenerationOutput(
      JSON.stringify({
        type: "code_generation",
        author: "agent_a",
        changedFiles: ["src/auth.js"],
        summary: "Applied changes"
      })
    );

    expect(parsed.author).toBe("agent_a");
    expect(parsed.changedFiles).toEqual(["src/auth.js"]);
  });

  it("rejects invalid review payloads", () => {
    expect(() => parseReviewOutput(JSON.stringify({ type: "code_generation" }))).toThrow(
      "Expected review output"
    );
  });
});
