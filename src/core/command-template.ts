export type SupportedPlatform = NodeJS.Platform;

export function escapeForShell(value: string, platform: SupportedPlatform = process.platform): string {
  if (platform === "win32") {
    return `'${value.replace(/'/g, "''")}'`;
  }

  return `'${value.replace(/'/g, `'\\''`)}'`;
}

export function extractExecutable(commandTemplate: string): string | null {
  const trimmed = commandTemplate.trim();

  if (!trimmed) {
    return null;
  }

  const match = trimmed.match(/^(['"])(.+?)\1|^([^\s|&;]+)/);
  const executable = match?.[2] ?? match?.[3] ?? null;

  if (!executable) {
    return null;
  }

  if (executable.includes("{{")) {
    return null;
  }

  return executable;
}
