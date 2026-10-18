import { LoggerService } from '@nestjs/common';

/** ~30-line JSON logger to stdout (spec §5.11): one line per event, level+time+context+message. */
export class JsonLogger implements LoggerService {
  private out(level: string, context: string, message: unknown, stack?: string) {
    process.stdout.write(
      JSON.stringify({ level, time: new Date().toISOString(), context, message: String(message), ...(stack && { stack }) }) + '\n',
    );
  }
  log(m: unknown, c = 'Nest') { this.out('info', c, m); }
  /** Nest LoggerService order: error(message, stack?, context?); Logger.error(msg) without stack passes context 2nd. */
  error(m: unknown, stackOrContext?: string, context?: string) {
    if (context !== undefined) return this.out('error', context, m, stackOrContext);
    const isStack = !!stackOrContext && stackOrContext.includes('\n');
    this.out('error', isStack ? 'Nest' : (stackOrContext ?? 'Nest'), m, isStack ? stackOrContext : undefined);
  }
  warn(m: unknown, c = 'Nest') { this.out('warn', c, m); }
  debug(m: unknown, c = 'Nest') { this.out('debug', c, m); }
  verbose(m: unknown, c = 'Nest') { this.out('verbose', c, m); }
}
