import chalk from "chalk"

export const style = {
  tool: chalk.cyan,
  dim: chalk.dim,
  dimError: chalk.dim.red,
}

export function log(tag: string, text: string, format?: (s: string) => string, icon = "○"): void {
  const formatted = format ? format(text) : text
  console.log(`${icon} ${chalk.dim(`[${tag}]`)} ${formatted}`)
}

export function info(text: string): void {
  log("run", text, chalk.blue, "○")
}

export function step(text: string): void {
  log("run", text, chalk.cyan, "→")
}

export function success(text: string): void {
  log("run", text, chalk.green, "✓")
}

export function warn(text: string): void {
  log("run", text, chalk.yellow, "⚠")
}

export function error(text: string): void {
  log("run", text, chalk.red, "✗")
}

export function dim(text: string): void {
  log("run", text, chalk.dim, "○")
}
