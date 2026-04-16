import { describe, expect, it } from "vitest";

import { escapeForShell, extractExecutable } from "../core/command-template";

describe("command template helpers", () => {
  it("escapes prompt literals for posix shells", () => {
    const escaped = escapeForShell("hello 'world'", "linux");

    expect(escaped).toBe("'hello '\\''world'\\'''");
  });

  it("escapes prompt literals for powershell", () => {
    const escaped = escapeForShell("hello 'world'", "win32");

    expect(escaped).toBe("'hello ''world'''");
  });

  it("extracts the executable from simple command templates", () => {
    expect(extractExecutable("claude -p {{prompt}}")).toBe("claude");
    expect(extractExecutable('"codex" exec --full-auto {{prompt}}')).toBe("codex");
  });
});
