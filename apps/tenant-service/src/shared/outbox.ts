import { OutboxWriter } from '@super-app/db';
import { PRODUCER } from '../events/catalog.js';
import { TENANCY_SCHEMA } from '../db/migration-sql.js';

export const outbox = new OutboxWriter(TENANCY_SCHEMA, PRODUCER);
