import { PrismaPg } from '@prisma/adapter-pg';
import { AppError } from '@super-app/common';
import { withPrismaTenant } from '@super-app/db';
import { Prisma, PrismaClient } from '../gen/prisma/client.js';

export type Tx = Prisma.TransactionClient;
export type JsonInput = Prisma.InputJsonValue;

export function createPrisma(connectionString: string, applicationName: string): PrismaClient {
  return new PrismaClient({ adapter: new PrismaPg({ connectionString, application_name: applicationName }) });
}

export class TenancyDb {
  constructor(
    readonly reader: PrismaClient,
    readonly writer: PrismaClient,
  ) {}

  read<T>(tenantId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
    return withPrismaTenant(this.reader, tenantId, fn);
  }

  write<T>(tenantId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
    return withPrismaTenant(this.writer, tenantId, fn);
  }

  async disconnect(): Promise<void> {
    await Promise.all([this.reader.$disconnect(), this.writer.$disconnect()]);
  }
}

export function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

export async function conflictOnDuplicate<T>(operation: Promise<T>, details: Record<string, unknown>): Promise<T> {
  try {
    return await operation;
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new AppError('CONFLICT', { reason: 'ALREADY_EXISTS', ...details }, { cause: error });
    }
    throw error;
  }
}

export function asJson(value: unknown): JsonInput {
  return value as JsonInput;
}
