import type { Probeable, WebhookEventBase } from '../types.js';

export type KycDocumentType =
  | 'NATIONAL_ID'
  | 'PASSPORT'
  | 'DRIVING_LICENCE'
  | 'RESIDENCE_PERMIT'
  | 'PROOF_OF_ADDRESS'
  | 'SELFIE'
  | 'LIVENESS_VIDEO';

export type KycCheckType =
  | 'OCR'
  | 'AUTHENTICITY'
  | 'LIVENESS'
  | 'FACE_MATCH'
  | 'SANCTIONS'
  | 'PEP'
  | 'ADVERSE_MEDIA'
  | 'ADDRESS';

export interface KycCheckResult {
  readonly checkType: KycCheckType;
  readonly result: 'PASS' | 'FAIL' | 'REVIEW';
  readonly score?: number;
  readonly extracted?: Readonly<Record<string, unknown>>;
}

export type KycProviderEvent =
  | (WebhookEventBase & {
      readonly kind: 'APPLICANT_REVIEWED';
      readonly providerApplicantId: string;
    })
  | (WebhookEventBase & {
      readonly kind: 'CHECK_COMPLETED';
      readonly providerApplicantId: string;
      readonly checkType: KycCheckType;
    });

export interface KycProviderAdapter extends Probeable {
  createApplicant(request: {
    readonly applicationId: string;
    readonly userRef: string;
    readonly targetTier: number;
    readonly person: {
      readonly fullName: string;
      readonly dob?: string;
      readonly nationality?: string;
    };
  }): Promise<{ readonly providerApplicantId: string }>;
  submitDocuments(
    providerApplicantId: string,
    documents: readonly {
      readonly docType: KycDocumentType;
      readonly side?: 'FRONT' | 'BACK';
      readonly downloadUrl: string;
      readonly contentType: string;
    }[],
  ): Promise<void>;
  getResult(providerApplicantId: string): Promise<{
    readonly status: 'PENDING' | 'COMPLETED';
    readonly checks: readonly KycCheckResult[];
  }>;
  screenSanctions(subject: {
    readonly entityType: 'PERSON' | 'BUSINESS';
    readonly fullName: string;
    readonly dob?: string;
    readonly nationality?: string;
  }): Promise<{
    readonly matches: readonly {
      readonly source: string;
      readonly entryRef: string;
      readonly score: number;
    }[];
  }>;
  handleWebhook(payload: Buffer, signature: string): Promise<KycProviderEvent[]>;
  createLivenessSession(
    providerApplicantId: string,
  ): Promise<{ readonly sdkToken: string; readonly expiresAt: string }>;
}
