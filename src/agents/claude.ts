import { quoteShell } from "#src/agent.js"
import type { Agent, ParsedStreamEvent } from "#src/types.js"

const TOOL_ARG_FIELDS: Record<string, string> = {
  Edit: "file_path",
  Bash: "command",
  Glob: "pattern",
  Grep: "pattern",
  Read: "file_path",
  WebSearch: "query",
  WebFetch: "url",
  Write: "file_path",
  Agent: "description",
}

export const parseStreamJsonLine = (line: string): ParsedStreamEvent[] => {
  if (!line.startsWith("{")) {
    return []
  }

  try {
    const obj = JSON.parse(line)

    if (obj.type === "assistant" && Array.isArray(obj.message?.content)) {
      const events: ParsedStreamEvent[] = []
      const texts: string[] = []

      for (const block of obj.message.content as {
        type: string
        text?: string
        name?: string
        input?: Record<string, unknown>
      }[]) {
        if (block.type === "text" && typeof block.text === "string") {
          texts.push(block.text)
          continue
        }

        if (
          block.type !== "tool_use" ||
          typeof block.name !== "string" ||
          block.input === undefined
        ) {
          continue
        }

        const argField = TOOL_ARG_FIELDS[block.name]
        if (argField === undefined) {
          continue
        }

        const argValue = block.input[argField]
        if (typeof argValue !== "string") {
          continue
        }

        if (texts.length > 0) {
          events.push({ type: "text", text: texts.join("") })
          texts.length = 0
        }

        events.push({
          type: "tool_call",
          name: block.name,
          args: argValue,
        })
      }

      if (texts.length > 0) {
        events.push({ type: "text", text: texts.join("") })
      }

      return events
    }

    if (obj.type === "result" && typeof obj.result === "string") {
      return [{ type: "result", result: obj.result }]
    }

    if (obj.type === "system" && obj.subtype === "init" && typeof obj.session_id === "string") {
      return [{ type: "session_id", sessionId: obj.session_id }]
    }
  } catch {
    // Ignore non-JSON output mixed into stream-json stdout.
  }

  return []
}

export function claudeCode(
  model: string,
  config?: {
    effort?: "low" | "medium" | "high"
  },
): Agent {
  return {
    name: "claude-code",

    buildCommand({ prompt }) {
      const command = [
        "claude",
        `--model ${quoteShell(model)}`,
        `-p ${quoteShell(prompt)}`,
        config?.effort ? `-effort ${quoteShell(config.effort)}` : null,
        "--permission-mode bypassPermissions",
        "--print",
        "--verbose",
        "--output-format stream-json",
      ]
        .filter(Boolean)
        .join(" ")

      return { command }
    },

    parseStreamLine(line) {
      return parseStreamJsonLine(line)
    },
  }
}
