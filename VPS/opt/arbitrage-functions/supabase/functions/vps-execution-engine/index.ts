// Scanner discoveries are persisted by opportunity-buffer, then queued using saved user settings.
// Do not execute in-memory signals through a competing execution pipeline.
export function enqueueExecution(_opportunity:unknown) {}
export function startEngine() {}
