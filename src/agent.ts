export interface AgentCommand {
  command: string
}

export type ParsedStreamEvent =
  | { type: "text"; text: string }
  | { type: "result"; result: string }
  | { type: "tool_call"; name: string; args: string }
  | { type: "session_id"; sessionId: string }

export interface Agent<T = object> {
  name: string
  buildCommand(input: T & { prompt: string }): AgentCommand
  parseStreamLine?: (line: string) => ParsedStreamEvent[]
}

export function quoteShell(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`
}
