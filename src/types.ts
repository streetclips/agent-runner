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

  start(input: { workspaceDir: string }): Promise<SandboxHandle>
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

export type TaskStatus = "completed" | "max_iterations" | "failed"

export type TaskHookPhase = "sandbox-create" | "agent-start" | "agent-finish" | "sandbox-close"

export type TaskMetadata = Record<string, unknown>

export interface TaskHookContext {
  workspaceDir: string
  options: RunTaskOptions
  phase: TaskHookPhase
  sandbox?: SandboxHandle
  result?: RunTaskResult
  status?: TaskStatus
  error?: unknown
  metadata: TaskMetadata
}

export type TaskHook = (context: TaskHookContext) => Promise<unknown> | unknown

export interface RunTaskOptions {
  agent: Agent
  sandbox: Sandbox
  prompt: string
  workspaceDir: string
  maxIterations?: number
  completionSignal?: string | string[]
  idleTimeoutSeconds?: number
  logging?: LoggingOption
  onStep?: (event: ParsedStreamEvent, context: { iteration: number }) => void
  hooks?: Partial<Record<TaskHookPhase, TaskHook | TaskHook[]>>
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
  workspaceDir: string
  iterations: IterationResult[]
  stdout: string
  status: TaskStatus
  completionSignal?: string
  error?: unknown
  metadata: TaskMetadata
  logFilePath?: string
}

export type RunTaskResult = RunResult
