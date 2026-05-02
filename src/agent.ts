export interface AgentCommand {
  command: string;
}

export type ParsedStreamEvent =
  | { type: "text"; text: string }
  | { type: "result"; result: string }
  | { type: "tool_call"; name: string; args: string }
  | { type: "session_id"; sessionId: string };

export interface Agent {
  name: string;
  buildCommand(input: { prompt: string }): AgentCommand;
  parseStreamLine?: (line: string) => ParsedStreamEvent[];
}

export function shellAgent(options: { name?: string; command: string }): Agent {
  return {
    name: options.name ?? "shell-agent",

    buildCommand({ prompt }) {
      return {
        command: `${options.command} ${quoteShell(prompt)}`,
      };
    },
  };
}

function quoteShell(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}
