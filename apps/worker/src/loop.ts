/**
 * Runs `task` repeatedly with `intervalMs` between the end of one run and the start of the next
 * (no overlap). Errors are logged and the loop continues — a database blip must not kill the worker.
 */
export function every(name: string, intervalMs: number, task: () => Promise<unknown>) {
  let timer: NodeJS.Timeout | undefined;
  let stopped = false;
  let running: Promise<void> = Promise.resolve();

  const tick = () => {
    running = (async () => {
      try {
        await task();
      } catch (error) {
        console.error(`[worker:${name}] failed:`, error instanceof Error ? `${error.name}: ${error.message}` : error);
      }
    })().finally(() => {
      if (!stopped) timer = setTimeout(tick, intervalMs);
    });
  };
  tick();

  return {
    async stop() {
      stopped = true;
      clearTimeout(timer);
      await running;
    },
  };
}
