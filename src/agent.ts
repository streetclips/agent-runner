export interface AgentCommand {
  command: string;
  stdin?: string;
}

export interface Agent {
  name: string;
  buildCommand(input: { prompt: string }): AgentCommand;
}

export function shellAgent(options: { name?: string; command: string }): Agent {
  return {
    name: options.name ?? "shell-agent",

    buildCommand({ prompt }) {
      return {
        command: options.command,
        stdin: prompt,
      };
    },
  };
}
