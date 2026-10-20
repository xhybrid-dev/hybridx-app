// src/lib/marketing/stage.ts
//
// Timed, logged stages for the studio's AI flows.
//
// logger.log is silent in production, and nothing here had a server-side
// deadline, so a stalled step (Firestore read, model call) produced no log and
// no error — the browser just gave up. Each stage now logs start/finish with
// its duration through console directly, and fails with its own name on a
// deadline, so the cause is visible in the App Hosting logs and the UI.

export async function stage<T>(
  flow: string,
  name: string,
  timeoutMs: number,
  run: () => Promise<T>,
): Promise<T> {
  const started = Date.now();
  console.log(`[studio:${flow}] ${name} started`);

  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`${name} did not finish within ${Math.round(timeoutMs / 1000)}s.`)),
      timeoutMs,
    );
  });

  try {
    const result = await Promise.race([run(), deadline]);
    console.log(`[studio:${flow}] ${name} finished in ${Date.now() - started}ms`);
    return result;
  } catch (err) {
    console.error(
      `[studio:${flow}] ${name} failed after ${Date.now() - started}ms:`,
      err instanceof Error ? err.message : String(err),
    );
    throw err;
  } finally {
    if (timer) clearTimeout(timer);
  }
}
