import { Injectable } from '@nestjs/common';
import { execFile } from 'node:child_process';

export interface ExecResult { stdout: string; stderr: string; code: number }

/** Injectable wrapper around execFile so tests can substitute a fake. */
@Injectable()
export class ExecRunnerService {
  exec(cmd: string, args: string[], opts: { timeoutMs?: number } = {}): Promise<ExecResult> {
    return new Promise((resolve) => {
      execFile(cmd, args, { timeout: opts.timeoutMs ?? 120_000, maxBuffer: 64 * 1024 * 1024 }, (err, stdout, stderr) => {
        const code = err && typeof (err as { code?: unknown }).code === 'number' ? (err as { code: number }).code : err ? 1 : 0;
        resolve({ stdout: String(stdout ?? ''), stderr: String(stderr ?? ''), code });
      });
    });
  }
}
