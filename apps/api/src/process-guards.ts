export interface GuardLogger {
  error(message: string): void;
  fatal?(message: string): void;
}

export interface GuardOptions {
  /** Called after an uncaught exception has been logged; production exits so the restart policy brings a clean process. */
  exit?: (code: number) => void;
  /** Delay before exiting, so the logger can flush. */
  exitDelayMs?: number;
}

const describe = (e: unknown) => (e instanceof Error ? (e.stack ?? e.message) : String(e));

/**
 * Process-level safety net. An unhandled rejection is logged and the process keeps running (a stray rejected
 * promise in a consumer must not take down every other job). An uncaught exception leaves the process in an unknown
 * state, so it is logged and the process exits with code 1; docker `restart: unless-stopped` restarts it.
 * Returns a function that removes the handlers (for tests).
 */
export function installProcessGuards(
  log: () => GuardLogger,
  proc: Pick<NodeJS.Process, "on" | "off"> = process,
  options: GuardOptions = {},
): () => void {
  const exit = options.exit ?? ((code: number) => process.exit(code));
  const onRejection = (reason: unknown) => log().error(`unhandledRejection: ${describe(reason)}`);
  const onException = (err: Error) => {
    const l = log();
    (l.fatal ?? l.error).call(l, `uncaughtException: ${describe(err)}; exiting for a restart`);
    setTimeout(() => exit(1), options.exitDelayMs ?? 300);
  };
  proc.on("unhandledRejection", onRejection);
  proc.on("uncaughtException", onException);
  return () => {
    proc.off("unhandledRejection", onRejection);
    proc.off("uncaughtException", onException);
  };
}
