import 'reflect-metadata';
import { runService } from '@super-app/nest';
import { AppModule } from './app.module.js';

await runService({ name: 'tenant-service', module: AppModule });
