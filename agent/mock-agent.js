import { readFile, writeFile } from "node:fs/promises";

let prompt = "";

process.stdin.setEncoding("utf8");

for await (const chunk of process.stdin) {
  prompt += chunk;
}

console.log("Agent received prompt:");
console.log(prompt);

const readmePath = "/workspace/README.md";

let readme = "";

try {
  readme = await readFile(readmePath, "utf8");
} catch {
  readme = "# Demo\n";
}

await writeFile(
  readmePath,
  `${readme.trim()}

Edited by mock agent.
`,
);

console.log("<promise>COMPLETE</promise>");
