import { describe, expect, it } from "vitest";

import {
  DEFAULT_AGENT_A,
  DEFAULT_AGENT_B,
  DEFAULT_STAGES
} from "../core/defaults";

describe("built-in defaults", () => {
  it("ships with a Claude to Codex preset", () => {
    expect(DEFAULT_AGENT_A.name).toBe("Claude");
    expect(DEFAULT_AGENT_B.name).toBe("Codex");
  });

  it("uses the expected dual-agent stage order", () => {
    expect(DEFAULT_STAGES.map((stage) => stage.id)).toEqual([
      "agent_a_generate",
      "agent_b_review",
      "agent_b_generate",
      "agent_a_review"
    ]);
  });

  it("keeps prompt and command defaults wired to runtime files", () => {
    expect(DEFAULT_AGENT_A.mode).toBe("interactive");
    expect(DEFAULT_AGENT_B.mode).toBe("interactive");
    expect(DEFAULT_AGENT_A.executable).toBe("claude");
    expect(DEFAULT_AGENT_B.executable).toBe("codex");
    expect(DEFAULT_AGENT_A.args).toEqual([]);
    expect(DEFAULT_AGENT_B.args).toEqual([]);
    expect(DEFAULT_AGENT_A.startupAutoResponses).toEqual([]);
    expect(DEFAULT_AGENT_B.startupAutoResponses).toHaveLength(1);
    expect(DEFAULT_AGENT_B.startupAutoResponses[0]?.matchAll).toContain("Do you trust the contents of this directory?");
    expect(DEFAULT_AGENT_A.prompts.generate).toContain("{{outputFile}}");
    expect(DEFAULT_AGENT_B.prompts.review).toContain("{{outputFile}}");
  });
});
