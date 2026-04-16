import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

describe("extension manifest defaults", () => {
  it("exposes Claude and Codex as the built-in setting defaults", () => {
    const manifestPath = path.resolve(process.cwd(), "package.json");
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
      contributes: {
        configuration: {
          properties: Record<string, { default?: unknown }>;
        };
      };
    };

    const properties = manifest.contributes.configuration.properties;

    expect(properties["dualAgent.agentA.name"]?.default).toBe("Claude");
    expect(properties["dualAgent.agentB.name"]?.default).toBe("Codex");
    expect(properties["dualAgent.agentA.commandTemplate"]?.default).toBe(
      'Get-Content -Raw "{{promptFile}}" | claude'
    );
    expect(properties["dualAgent.agentB.commandTemplate"]?.default).toBe(
      'Get-Content -Raw "{{promptFile}}" | codex'
    );
  });
});
