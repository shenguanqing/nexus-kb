import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';

import { AppModule } from './app.module';
import { AppConfig } from './config/app-config';
import { IndexMigrationService } from './ingestion/index-migration.service';

async function main(): Promise<void> {
  const application = await NestFactory.createApplicationContext(AppModule, { logger: false });
  try {
    const config = application.get(AppConfig);
    const migration = application.get(IndexMigrationService);
    const result =
      config.values.INDEX_MIGRATION_ACTION === 'prepare'
        ? await migration.prepare()
        : config.values.INDEX_MIGRATION_ACTION === 'activate'
          ? await migration.activate()
          : null;
    if (!result) throw new Error('INDEX_MIGRATION_ACTION must be prepare or activate');
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } finally {
    await application.close();
  }
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : 'Index migration failed';
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
