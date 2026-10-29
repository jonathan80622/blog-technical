/** Runtime evidence channel consumed only by the standalone test observer. */
export function emitTestTrace(event: unknown) {
  if (process.env.TEST_TRACE === "1") console.log(`@@TEST_TRACE@@${JSON.stringify(event)}`);
}
