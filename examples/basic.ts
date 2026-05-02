import { docker, run, shellAgent } from "../src/index.js";

const result = await run({
  agent: shellAgent({
    command: "node /agent/mock-agent.js",
  }),

  sandbox: docker({
    imageName: "mini-agent-runner:local",
    dockerfile: "Dockerfile",
  }),

  branch: "agent/demo",
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
