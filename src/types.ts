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

export interface ExecResult {
  stdout: string
  stderr: string
  exitCode: number
}

export interface Sandbox {
  name: string

  start(input: { repoDir: string; worktreeDir: string }): Promise<SandboxHandle>
}

export interface SandboxHandle {
  exec(input: {
    command: string
    idleTimeoutMs?: number
    onStdout?: (chunk: string) => void
    onStderr?: (chunk: string) => void
  }): Promise<ExecResult>

  close(): Promise<void>
}

export type LoggingOption =
  | {
      type: "file"
      path?: string
      tee?: boolean
    }
  | {
      type: "stdout"
    }

export interface RunOptions {
  agent: Agent
  sandbox: Sandbox
  prompt: string
  branch: string
  cwd?: string
  maxIterations?: number
  completionSignal?: string | string[]
  idleTimeoutSeconds?: number
  logging?: LoggingOption
  onStep?: (event: ParsedStreamEvent, context: { iteration: number }) => void
}

export interface IterationResult {
  index: number
  stdout: string
  stderr: string
  exitCode: number
  parsedEvents: ParsedStreamEvent[]
  completionSignal?: string
}

export interface RunResult {
  branch: string
  worktreeDir: string
  iterations: IterationResult[]
  stdout: string
  completionSignal?: string
  commits: { sha: string }[]
  logFilePath?: string
}
