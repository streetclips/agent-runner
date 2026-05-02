import type { Agent } from "../agent.js";

export function claudeCode(model: string): Agent {
  return {
    name: "claude-code",

    buildCommand({ prompt }) {
      return {
        command: `claude --model ${quoteShell(model)} -p ${quoteShell(prompt)} --permission-mode bypassPermissions`,
      };
    },
  };
}

function quoteShell(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}
