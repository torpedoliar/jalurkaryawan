import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable, map } from 'rxjs';

/** mock parity: undefined → 204, never 201 (Nest POST default → forced 200). */
@Injectable()
export class ResponseInterceptor implements NestInterceptor {
  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    const res = ctx.switchToHttp().getResponse<import('express').Response>();
    return next.handle().pipe(
      map((v) => {
        if (v === undefined) {
          res.status(204);
          return null;
        }
        if (res.statusCode === 201) res.status(200);
        return v;
      }),
    );
  }
}
