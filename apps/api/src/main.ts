import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { JsonLogger } from './common/json-logger.service';

try {
  process.loadEnvFile();
} catch { /* no .env in container if env injected */ }

async function bootstrap() {
  if (!process.env.APP_SECRET) throw new Error('APP_SECRET wajib diisi.');
  const app = await NestFactory.create(AppModule, { logger: new JsonLogger() });
  app.setGlobalPrefix('api');
  app.enableShutdownHooks();
  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port, '0.0.0.0');
  new JsonLogger().log(`listening :${port}`, 'Bootstrap');
}
void bootstrap();
