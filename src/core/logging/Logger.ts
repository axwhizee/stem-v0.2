// 日志 —— 只追加观测，无业务分支。

export type LogEvent = {
  readonly at: number
  readonly level: 'debug' | 'info' | 'warn' | 'error'
  readonly scope: string
  readonly message: string
  readonly data?: unknown
}

export type LogSink = {
  readonly write: (event: LogEvent) => void
}

export class Logger {
  #sink: LogSink | undefined

  constructor(sink?: LogSink) {
    this.#sink = sink
  }

  bind(sink: LogSink): void {
    this.#sink = sink
  }

  log(event: Omit<LogEvent, 'at'> & { at?: number }): void {
    this.#sink?.write({ at: event.at ?? Date.now(), ...event })
  }

  info(scope: string, message: string, data?: unknown): void {
    this.log({ level: 'info', scope, message, data })
  }

  warn(scope: string, message: string, data?: unknown): void {
    this.log({ level: 'warn', scope, message, data })
  }

  error(scope: string, message: string, data?: unknown): void {
    this.log({ level: 'error', scope, message, data })
  }
}

/** 内存收集器，供测试与组合根默认实现。 */
export class MemoryLogSink implements LogSink {
  readonly events: LogEvent[] = []
  write(event: LogEvent): void {
    this.events.push(event)
  }
}
