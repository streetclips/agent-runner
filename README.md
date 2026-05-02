# Mini Agent Runner

A minimal TypeScript runner that executes a shell-based agent inside a Docker sandbox, using a Git worktree as the isolated workspace.

## Usage

```ts
import { run, shellAgent, docker } from "./src/index.js";

const result = await run({
  agent: shellAgent({
    command: "node /agent/mock-agent.js",
  }),
  sandbox: docker({
    imageName: "mini-agent-runner:local",
    dockerfile: "Dockerfile",
  }),
  prompt: "Update the README and finish with <promise>COMPLETE</promise>",
  branch: "agent/demo",
  maxIterations: 3,
  // Default: writes agent stdout/stderr to .mini-agent/logs/<branch>-<agent>.log
  // and tees the in-container output to your terminal.
  // Use logging: { type: "file", tee: false } for quiet file-only logging.
  // Use logging: { type: "stdout" } for terminal-only logging.
});

console.log(result);
```

`result.logFilePath` contains the path to the log file when file logging is used.

Run the included example:

```bash
npm run dev
```
