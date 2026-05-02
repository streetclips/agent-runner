import { mkdir, rm } from "node:fs/promises"
import path from "node:path"
import { exec } from "#src/exec.js"

export async function createWorktree(input: {
  repoDir: string
  branch: string
}): Promise<string> {
  const safeBranch = input.branch.replace(/[^a-zA-Z0-9._/-]/g, "-")

  const worktreePath = path.join(
    input.repoDir,
    ".agent-runner",
    "worktrees",
    safeBranch.replaceAll("/", "-"),
  )

  await mkdir(path.dirname(worktreePath), { recursive: true })
  const existingWorktreePath = await findWorktreeForBranch({
    repoDir: input.repoDir,
    branch: input.branch,
  })
  const pathToRemove = existingWorktreePath ?? worktreePath
  const remove = await exec("git", ["worktree", "remove", "--force", pathToRemove], {
    cwd: input.repoDir,
  })

  if (remove.exitCode !== 0 && !remove.stderr.includes("is not a working tree")) {
    throw new Error(remove.stderr)
  }

  await rm(worktreePath, { recursive: true, force: true })

  const result = await exec("git", ["worktree", "add", "-B", input.branch, worktreePath, "HEAD"], {
    cwd: input.repoDir,
  })

  if (result.exitCode !== 0) {
    throw new Error(result.stderr)
  }

  return worktreePath
}

async function findWorktreeForBranch(input: {
  repoDir: string
  branch: string
}): Promise<string | undefined> {
  const result = await exec("git", ["worktree", "list", "--porcelain"], {
    cwd: input.repoDir,
  })

  if (result.exitCode !== 0) {
    throw new Error(result.stderr)
  }

  const entries = result.stdout
    .trim()
    .split(/\n(?=worktree )/)
    .filter(Boolean)

  for (const entry of entries) {
    const worktree = entry.match(/^worktree (.+)$/m)?.[1]
    const branch = entry.match(/^branch refs\/heads\/(.+)$/m)?.[1]

    if (worktree && branch === input.branch) {
      return worktree
    }
  }

  return undefined
}

export async function commitAll(input: {
  cwd: string
  message: string
}): Promise<{ sha?: string }> {
  await exec("git", ["add", "-A"], { cwd: input.cwd })

  const diff = await exec("git", ["diff", "--cached", "--quiet"], {
    cwd: input.cwd,
  })

  if (diff.exitCode === 0) {
    return {}
  }

  const commit = await exec("git", ["commit", "-m", input.message], {
    cwd: input.cwd,
  })

  if (commit.exitCode !== 0) {
    throw new Error(commit.stderr)
  }

  const sha = await exec("git", ["rev-parse", "HEAD"], {
    cwd: input.cwd,
  })

  if (sha.exitCode !== 0) {
    throw new Error(sha.stderr)
  }

  return {
    sha: sha.stdout.trim(),
  }
}
