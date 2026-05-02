export type { Agent, AgentCommand, ParsedStreamEvent } from "#src/types.js"

export function quoteShell(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`
}
