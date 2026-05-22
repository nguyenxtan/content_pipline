// Safely fills {{variable}} placeholders – no eval, no code execution.
export function renderPrompt(
  template: string,
  variables: Record<string, string>
): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => {
    const value = variables[key];
    // Leave unfilled variables as-is so caller can detect missing ones
    return value !== undefined ? value : `{{${key}}}`;
  });
}
