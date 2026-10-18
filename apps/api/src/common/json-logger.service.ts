import { LoggerService } from '@nestjs/common';

/** ~30-line JSON logger to stdout (spec §5.11): one line per event, level+time+context+message. */
export class JsonLogger implements LoggerService {
  private out(level: string, context: string, message: unknown) {
    process.stdout.write(
      JSON.stringify({ level, time: new Date().toISOString(), context, message: String(message) }) + '\n',
    );
  }
  log(m: unknown, c = 'Nest') { this.out('info', c, m); }
  error(m: unknown, c = 'Nest') { this.out('error', c, m); }
  warn(m: unknown, c = 'Nest') { this.out('warn', c, m); }
  debug(m: unknown, c = 'Nest') { this.out('debug', c, m); }
  verbose(m: unknown, c = 'Nest') { this.out('verbose', c, m); }
}
