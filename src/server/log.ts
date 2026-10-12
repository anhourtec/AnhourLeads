import "server-only";

type Level = "debug" | "info" | "warn" | "error";
const ORDER: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };
const REDACT = /pass(word)?|secret|token|api[-_]?key|authorization|cookie/i;

function redact(value: unknown, depth = 0): unknown {
  if (depth > 4 || value === null || typeof value !== "object") return value;
  if (value instanceof Error) return { name: value.name, message: value.message };
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));
  return Object.fromEntries(
    Object.entries(value).map(([k, v]) => [k, REDACT.test(k) ? "[redacted]" : redact(v, depth + 1)]),
  );
}

function threshold(): number {
  const level = (process.env.LOG_LEVEL as Level | undefined) ?? "info";
  return ORDER[level] ?? ORDER.info;
}

export interface Logger {
  debug(msg: string, fields?: Record<string, unknown>): void;
  info(msg: string, fields?: Record<string, unknown>): void;
  warn(msg: string, fields?: Record<string, unknown>): void;
  error(msg: string, fields?: Record<string, unknown>): void;
  child(fields: Record<string, unknown>): Logger;
}

function make(base: Record<string, unknown>): Logger {
  const write = (level: Level, msg: string, fields?: Record<string, unknown>) => {
    if (ORDER[level] < threshold()) return;
    const line = JSON.stringify({
      time: new Date().toISOString(),
      level,
      msg,
      ...(redact({ ...base, ...fields }) as object),
    });
    process[level === "error" || level === "warn" ? "stderr" : "stdout"].write(`${line}\n`);
  };
  return {
    debug: (m, f) => write("debug", m, f),
    info: (m, f) => write("info", m, f),
    warn: (m, f) => write("warn", m, f),
    error: (m, f) => write("error", m, f),
    child: (fields) => make({ ...base, ...fields }),
  };
}

/** Structured JSON logger. Server code never uses console.* directly. */
export const log = make({});
