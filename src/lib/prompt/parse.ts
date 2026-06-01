const VAR_REGEX = /\{\{(\w+)\}\}/g;

export function extractVariables(template: string): string[] {
  const vars = new Set<string>();
  let match: RegExpExecArray | null;
  while ((match = VAR_REGEX.exec(template)) !== null) {
    vars.add(match[1]);
  }
  return Array.from(vars);
}
