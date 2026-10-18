import { beforeAll, describe, expect, test } from 'vitest';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AppModule } from '../src/app.module';

let app: INestApplication;

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication({ logger: false });
  app.setGlobalPrefix('api'); // mirrors main.ts — test asserts /api/health
  await app.init();
  // known http shape via raw fetch on the listening socket
  await app.listen(0);
});

test('GET /api/health answers 200 {status:"ok"}', async () => {
  const base = await app.getUrl();
  const res = await fetch(`${base}/api/health`);
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ status: 'ok' });
});
