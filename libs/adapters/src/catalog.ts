import type { AdapterContext, PartnerType } from './types.js';
import type { AdapterRegistry } from './registry.js';
import {
  AcquirerSimulator,
  BankSimulator,
  BillerSimulator,
  CardIssuerSimulator,
  KycProviderSimulator,
  MessagingSimulator,
  SIMULATOR_CONFIG_SCHEMA,
} from './simulators/index.js';

export const DEFAULT_SIMULATOR_PROVIDERS: Readonly<Record<PartnerType, readonly string[]>> = {
  BANK: ['bank-sim-a', 'bank-sim-b', 'bank-sim-c'],
  CARD_ISSUER: ['card-sim'],
  KYC: ['kyc-sim', 'kyc-sim-local'],
  ACQUIRER: ['acquirer-sim'],
  BILLER: ['biller-sim', 'biller-sim-local'],
  SMS: ['sms-sim', 'sms-sim-local'],
  EMAIL: ['email-sim'],
  PUSH: ['push-sim'],
};

const FACTORIES: Readonly<Record<PartnerType, (context: AdapterContext) => unknown>> = {
  BANK: (context) => new BankSimulator(context),
  CARD_ISSUER: (context) => new CardIssuerSimulator(context),
  KYC: (context) => new KycProviderSimulator(context),
  ACQUIRER: (context) => new AcquirerSimulator(context),
  BILLER: (context) => new BillerSimulator(context),
  SMS: (context) => new MessagingSimulator(context),
  EMAIL: (context) => new MessagingSimulator(context),
  PUSH: (context) => new MessagingSimulator(context),
};

export function registerSimulators(
  registry: AdapterRegistry,
  providers: Readonly<Record<PartnerType, readonly string[]>> = DEFAULT_SIMULATOR_PROVIDERS,
): AdapterRegistry {
  for (const [partnerType, names] of Object.entries(providers) as [
    PartnerType,
    readonly string[],
  ][]) {
    for (const provider of names) {
      registry.register({
        partnerType,
        provider,
        description: `Simulator for ${partnerType} used in local development, CI and staging`,
        configSchema: SIMULATOR_CONFIG_SCHEMA,
        create: FACTORIES[partnerType] as never,
      });
    }
  }
  return registry;
}
