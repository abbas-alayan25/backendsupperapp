import 'reflect-metadata';
import { runService } from '@super-app/nest';
import { AppModule } from './app.module.js';

await runService({ name: 'bills-service', module: AppModule });
