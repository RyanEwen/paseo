import { spawn, type ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import type { Readable, Writable } from "node:stream";
import { CdpPipe } from "./cdp-pipe.js";

export interface ChromiumProcessOptions {
  executablePath: string;
  /** A Chromium-owned directory, never Electron's live session directory. */
  profilePath: string;
  /** Explicit until the product's pane/window presentation policy is chosen. */
  headless: boolean;
}

/** Own one Chromium process independently of renderer, workspace and window activity.
 * Profiles are exclusive. Crashes are reported rather than silently recreating tabs
 * and losing unsaved document state. Shutdown waits for the owned process to exit.
 */
export class ChromiumProcess extends EventEmitter {
  public readonly cdp: CdpPipe;
  private stopping: Promise<void> | null = null;
  private readonly exited: Promise<void>;

  private constructor(
    private readonly child: ChildProcess,
    private readonly lockPath: string,
  ) {
    super();
    this.cdp = new CdpPipe(child.stdio[3] as Writable, child.stdio[4] as Readable);
    this.exited = new Promise<void>((resolve) => {
      child.once("exit", (code, signal) => {
        this.cdp.close(new Error(`Chromium exited (${code ?? signal})`));
        if (!this.stopping) this.emit("crashed", { code, signal });
        resolve();
      });
      child.once("error", (error) => {
        this.cdp.close(error);
        resolve();
      });
    });
  }

  /** Start an explicitly selected binary using private pipes and an exclusive profile.
   * No executable discovery, first-run download, debugging port or sandbox bypass.
   */
  public static async launch(options: ChromiumProcessOptions): Promise<ChromiumProcess> {
    if (!isAbsolute(options.executablePath) || !isAbsolute(options.profilePath)) {
      throw new Error("Chromium executable and profile paths must be absolute");
    }
    await mkdir(options.profilePath, { recursive: true, mode: 0o700 });
    const lockPath = join(options.profilePath, ".paseo-owner");
    try {
      await mkdir(lockPath, { mode: 0o700 });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") {
        throw new Error("Chromium profile is already owned; concurrent attachment is forbidden", {
          cause: error,
        });
      }
      throw error;
    }

    let runtime: ChromiumProcess | null = null;
    try {
      await writeFile(
        join(lockPath, "owner.json"),
        JSON.stringify({ supervisorPid: process.pid }),
        {
          mode: 0o600,
        },
      );
      const child = spawn(
        options.executablePath,
        [
          `--user-data-dir=${options.profilePath}`,
          "--remote-debugging-pipe",
          "--no-first-run",
          "--no-default-browser-check",
          "--no-startup-window",
          ...(options.headless ? ["--headless=new"] : []),
        ],
        { stdio: ["ignore", "ignore", "ignore", "pipe", "pipe"], windowsHide: true },
      );
      runtime = new ChromiumProcess(child, lockPath);
      await runtime.cdp.send("Browser.getVersion", {}, { timeoutMs: 10_000 });
      return runtime;
    } catch (error) {
      if (runtime) {
        await runtime.stop();
      } else {
        await rm(lockPath, { recursive: true, force: true });
      }
      throw error;
    }
  }

  /** Gracefully close Chromium, then retire the exact owned process if it stalls.
   * Repeated callers share cleanup. The profile lock stays until process exit.
   */
  public stop(): Promise<void> {
    if (!this.stopping) {
      // Set ownership before Browser.close can synchronously produce an exit.
      this.stopping = Promise.resolve().then(() => this.shutdown());
    }
    return this.stopping;
  }

  private async shutdown(): Promise<void> {
    if (this.child.exitCode === null && this.child.signalCode === null) {
      try {
        await this.cdp.send("Browser.close", {}, { timeoutMs: 2_000 });
      } catch {
        // Closing Chromium often retires the pipe before acknowledging the reply.
      }
      if (!(await this.waitForExit(3_000))) {
        this.child.kill("SIGKILL");
        if (!(await this.waitForExit(3_000))) {
          throw new Error("Chromium did not exit; its profile remains locked");
        }
      }
    }
    this.cdp.close();
    await this.exited;
    await rm(this.lockPath, { recursive: true, force: true });
  }

  /** Bound shutdown without leaving a timer behind after process retirement. */
  private async waitForExit(timeoutMs: number): Promise<boolean> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        this.exited.then(() => true),
        new Promise<boolean>((resolve) => {
          timer = setTimeout(() => resolve(false), timeoutMs);
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  }
}
