import { docker, run, shellAgent } from "../src/index.js";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const result = await run({
  agent: shellAgent({
    command: "node /agent/mock-agent.js",
  }),

  sandbox: docker({
    imageName: "mini-agent-runner:local",
    dockerfile: "Dockerfile",
  }),

  branch: "agent/demo",
  cwd: repoDir,
  prompt: "Actualiza el README y termina con <promise>COMPLETE</promise>",
  maxIterations: 3,
  idleTimeoutSeconds: 60,
});

console.log({
  branch: result.branch,
  worktreeDir: result.worktreeDir,
  iterations: result.iterations.length,
  completionSignal: result.completionSignal,
  commits: result.commits,
});
