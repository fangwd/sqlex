export const Levels = {
  TRACE: 0,
  DEBUG: 1,
  INFO: 2,
  WARN: 3,
  ERROR: 4,
  FATAL: 5,
};

export interface Options {
  name: string;
  level: keyof typeof Levels;
}

export class Logger {
  name: string;
  level: number;

  constructor(options: Options) {
    this.name = options.name;
    this.level = Levels[options.level];
  }

  write(...args: unknown[]) {
    console.log.apply(null, [this.name, ...args]);
  }

  trace(...args: unknown[]) {
    if (this.level <= Levels.TRACE) {
      this.write.apply(this, args);
    }
  }

  debug(...args: unknown[]) {
    if (this.level <= Levels.DEBUG) {
      this.write.apply(this, args);
    }
  }

  info(...args: unknown[]) {
    if (this.level <= Levels.INFO) {
      this.write.apply(this, args);
    }
  }

  warn(...args: unknown[]) {
    if (this.level <= Levels.WARN) {
      this.write.apply(this, args);
    }
  }

  error(...args: unknown[]) {
    if (this.level <= Levels.ERROR) {
      this.write.apply(this, args);
    }
  }

  fatal(...args: unknown[]) {
    if (this.level <= Levels.FATAL) {
      this.write.apply(this, args);
    }
  }
}

const logger = new Logger({
  name: '[sqlex]',
  level: (process.env.SQLEX_LOG || 'ERROR') as keyof typeof Levels,
});

export default logger;
