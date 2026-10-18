import { ArgumentMetadata, Injectable, PipeTransform } from '@nestjs/common';
import type { ZodTypeAny } from 'zod';
import { DomainError } from './domain-error';
import { zodMessage } from './zod';

/** Validates body/query through a shared @bms/shared schema; throws DomainError(VALIDATION_ERROR). */
@Injectable()
export class ZodPipe implements PipeTransform {
  constructor(private readonly schema: ZodTypeAny) {}

  transform(value: unknown, metadata: ArgumentMetadata): unknown {
    // method-level @UsePipes also runs on @Param — path ids are not the body schema
    if (metadata.type === 'param') return value;
    if (metadata.type === 'body' && typeof value === 'string') {
      throw new DomainError('VALIDATION_ERROR', 'Body harus JSON.');
    }
    const r = this.schema.safeParse(value);
    if (!r.success) throw new DomainError('VALIDATION_ERROR', zodMessage(r.error.issues[0]));
    return r.data;
  }
}

/** Factory usable as `new ZodPipe(Schema)` or decorator `@Body(new ZodPipe(Schema))`. */
export const zodBody = <T extends ZodTypeAny>(schema: T) => new ZodPipe(schema);
