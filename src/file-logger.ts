import { type WriteStream, createWriteStream } from "node:fs"
import { mkdir } from "node:fs/promises"
import path from "node:path"

export class FileLogger {
  constructor(
    readonly path: string,
    private readonly stream: WriteStream,
  ) {}

  static async create(filePath: string): Promise<FileLogger> {
    await mkdir(path.dirname(filePath), { recursive: true })
    const stream = createWriteStream(filePath, { flags: "a" })
    const logger = new FileLogger(filePath, stream)
    logger.write(`\n--- Run started: ${new Date().toISOString()} ---\n`)
    return logger
  }

  write(chunk: string): void {
    this.stream.write(chunk)
  }

  line(message: string): void {
    this.write(`${message}\n`)
  }

  close(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.stream.end((error?: Error | null) => {
        if (error) {
          reject(error)
          return
        }

        resolve()
      })
    })
  }
}
