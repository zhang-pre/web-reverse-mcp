import { mkdirSync, openSync, writeSync, closeSync, readFileSync, unlinkSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { dirname } from "node:path";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface LockInfo {
  token?: string;
  pid: number;
  ppid: number;
  host: string;
  port: number;
  ts: number;
}

/** Immutable cross-process ownership file. Normal close releases it. After a
 * crash, stop all MCP clients and remove the reported file before restarting.
 * No TTL or PID-based stealing: a long-running owner must never lose its browser.
 */
export class MarionetteLock {
  private held = false;
  private token = randomUUID();
  private cleanupRegistered = false;
  private onExit = () => this.release();

  constructor(
    private path: string,
    private self: Omit<LockInfo, "ts">,
  ) {}

  get filePath(): string { return this.path; }

  isHeld(): boolean {
    return this.held;
  }

  /** Read the current holder's info (best-effort; for error messages). */
  currentHolder(): LockInfo | null {
    try {
      return JSON.parse(readFileSync(this.path, "utf8")) as LockInfo;
    } catch {
      return null;
    }
  }

  /** True iff the lock file represents an owner that's still genuinely ours. */
  private isOurs(holder: LockInfo | null): boolean {
    return !!holder && holder.token === this.token;
  }

  /** Atomic exclusive creation; existing files are never stolen. */
  private tryAcquire(): boolean {
    if (this.held) return true;
    try {
      mkdirSync(dirname(this.path), { recursive: true });
    } catch {
      /* ignore */
    }
    try {
      const fd = openSync(this.path, "wx"); // O_CREAT|O_EXCL|O_WRONLY — atomic
      try {
        writeSync(fd, JSON.stringify({ ...this.self, token: this.token, ts: Date.now() } satisfies LockInfo));
      } finally {
        closeSync(fd);
      }
      this.held = true;
      this.registerCleanup();
      return true;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
      // Fail closed even for dead or malformed owners. Automatic unlink has an
      // ABA race and can remove a new owner's lock. Stop all clients before repair.
      return false;
    }
  }

  /** Wait up to timeoutMs to acquire. Returns true iff we own the lock. */
  async acquire(timeoutMs: number): Promise<boolean> {
    if (this.held) return true;
    const deadline = Date.now() + timeoutMs;
    let backoff = 100;
    for (;;) {
      if (this.tryAcquire()) return true;
      const left = deadline - Date.now();
      if (left <= 0) return false;
      await sleep(Math.min(backoff, left));
      backoff = Math.min(backoff * 2, 800);
    }
  }

  /** Verify ownership without rewriting a file another client could observe half-written. */
  renew(): void {
    if (this.held && !this.isOurs(this.currentHolder())) {
      this.held = false;
      throw new Error("Marionette ownership changed; stop all clients before recovery");
    }
  }

  /** Release the lock if we hold it (only removes the file if it's still ours). */
  release(): void {
    if (!this.held) return;
    this.held = false;
    process.removeListener("exit", this.onExit);
    this.cleanupRegistered = false;
    const holder = this.currentHolder();
    if (this.isOurs(holder)) {
      try {
        unlinkSync(this.path);
      } catch {
        /* ignore */
      }
    }
  }

  /** Best-effort release on graceful exit. */
  private registerCleanup(): void {
    if (this.cleanupRegistered) return;
    this.cleanupRegistered = true;
    process.once("exit", this.onExit);
  }
}
