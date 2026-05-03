import type { Agent, ParsedStreamEvent } from "../types.js"
import { quoteShell } from "../utils.js"

const TOOL_ARG_FIELDS = ["command", "filePath", "pattern", "query"] as const

interface OpenCodePartBase {
  id: string
  sessionID: string
  messageID: string
  type: string
}

interface OpenCodeTextPart extends OpenCodePartBase {
  type: "text"
  text: string
}

interface OpenCodeReasoningPart extends OpenCodePartBase {
  type: "reasoning"
  text: string
  metadata?: unknown
}

interface OpenCodeToolPart extends OpenCodePartBase {
  type: "tool"
  callID: string
  tool: string
  state: {
    status: "pending" | "running" | "completed" | "error"
    input?: unknown
    output?: unknown
    title?: string
    metadata?: unknown
    error?: unknown
  }
}

interface OpenCodeStepStartPart extends OpenCodePartBase {
  type: "step-start"
  snapshot?: string
}

interface OpenCodeStepFinishPart extends OpenCodePartBase {
  type: "step-finish"
  reason?: "stop" | "tool-calls" | string
  snapshot?: string
  cost?: number
  tokens?: {
    input?: number
    output?: number
    reasoning?: number
    cache?: {
      read?: number
      write?: number
    }
  }
}

interface OpenCodeStreamEventBase {
  timestamp: number
  sessionID: string
}

export type OpenCodeStreamEvent =
  | (OpenCodeStreamEventBase & { type: "step_start"; part: OpenCodeStepStartPart })
  | (OpenCodeStreamEventBase & { type: "text"; part: OpenCodeTextPart })
  | (OpenCodeStreamEventBase & { type: "reasoning"; part: OpenCodeReasoningPart })
  | (OpenCodeStreamEventBase & { type: "tool_use"; part: OpenCodeToolPart })
  | (OpenCodeStreamEventBase & { type: "step_finish"; part: OpenCodeStepFinishPart })
  | (OpenCodeStreamEventBase & { type: "error"; error: unknown })

function envAssignment(name: string, value: string | undefined): string | null {
  if (value === undefined) {
    return null
  }

  return `${name}=${quoteShell(value)}`
}

function parseToolArgs(input: unknown): string | undefined {
  if (input === undefined) {
    return undefined
  }

  if (typeof input === "object" && input !== null) {
    const record = input as Record<string, unknown>

    for (const field of TOOL_ARG_FIELDS) {
      const value = record[field]
      if (typeof value === "string") {
        return value
      }
    }
  }

  return JSON.stringify(input)
}

function tryParseOpenCodeStreamEvent(line: string): OpenCodeStreamEvent | undefined {
  if (!line.startsWith("{")) {
    return undefined
  }

  try {
    return JSON.parse(line) as OpenCodeStreamEvent
  } catch {
    // Ignore non-JSON output mixed into OpenCode's JSONL stdout.
    return undefined
  }
}

export const parseStreamJsonLine = (line: string): ParsedStreamEvent[] => {
  const event = tryParseOpenCodeStreamEvent(line)
  if (event === undefined) {
    return []
  }

  switch (event.type) {
    case "step_start":
      if (typeof event.sessionID === "string") {
        return [{ type: "session_id", sessionId: event.sessionID }]
      }
      return []
    case "text":
    case "reasoning":
      if (typeof event.part?.text === "string") {
        return [{ type: "text", text: event.part.text }]
      }
      return []
    case "tool_use": {
      if (typeof event.part?.tool !== "string") {
        return []
      }

      const args = parseToolArgs(event.part.state?.input)
      if (args === undefined) {
        return []
      }

      return [{ type: "tool_call", name: event.part.tool, args }]
    }
    case "step_finish":
      if (event.part?.reason === "stop") {
        return [{ type: "result", result: "stop" }]
      }
      return []
    case "error": {
      const message = typeof event.error === "string" ? event.error : JSON.stringify(event.error)
      return [{ type: "result", result: message }]
    }
    default:
      return []
  }
}

export function openCode(
  model: string,
  config?: {
    agent?: string
    title?: string
    config?: string
    configDir?: string
    configContent?: string
    thinking?: boolean
  },
): Agent {
  return {
    name: "opencode",

    buildCommand({ prompt }) {
      const env = [
        envAssignment("OPENCODE_CONFIG", config?.config),
        envAssignment("OPENCODE_CONFIG_DIR", config?.configDir),
        envAssignment("OPENCODE_CONFIG_CONTENT", config?.configContent),
      ]
        .filter(Boolean)
        .join(" ")

      const command = [
        env || null,
        "opencode",
        "run",
        `--model ${quoteShell(model)}`,
        config?.agent ? `--agent ${quoteShell(config.agent)}` : null,
        config?.title ? `--title ${quoteShell(config.title)}` : null,
        config?.thinking ? "--thinking" : null,
        "--format json",
        "--dangerously-skip-permissions",
        quoteShell(prompt),
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
