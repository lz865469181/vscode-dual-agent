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
    expect(DEFAULT_AGENT_A.commandTemplate).toContain("Get-Content -Raw");
    expect(DEFAULT_AGENT_A.commandTemplate).toContain("claude -p");
    expect(DEFAULT_AGENT_A.commandTemplate).toContain("{{promptFile}}");
    expect(DEFAULT_AGENT_B.commandTemplate).toContain("codex exec --full-auto");
    expect(DEFAULT_AGENT_A.prompts.generate).toContain("{{outputFile}}");
    expect(DEFAULT_AGENT_B.prompts.review).toContain("{{outputFile}}");
  });
});
