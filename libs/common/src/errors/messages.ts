import type { Locale } from '../i18n/locale.js';
import type { ErrorCode } from './error-codes.js';

export const ERROR_MESSAGES: Readonly<Record<ErrorCode, Readonly<Record<Locale, string>>>> = {
  VALIDATION_FAILED: {
    en: 'The request is invalid.',
    ar: 'الطلب غير صالح.',
  },
  UNAUTHENTICATED: {
    en: 'Authentication is required.',
    ar: 'يلزم تسجيل الدخول.',
  },
  FORBIDDEN: {
    en: 'You do not have permission to perform this action.',
    ar: 'ليس لديك صلاحية لتنفيذ هذا الإجراء.',
  },
  NOT_FOUND: {
    en: 'The requested resource was not found.',
    ar: 'لم يتم العثور على المورد المطلوب.',
  },
  CONFLICT: {
    en: 'The request conflicts with the current state of the resource.',
    ar: 'يتعارض الطلب مع الحالة الحالية للمورد.',
  },
  DUPLICATE_REQUEST: {
    en: 'This request has already been received.',
    ar: 'تم استلام هذا الطلب مسبقاً.',
  },
  INSUFFICIENT_FUNDS: {
    en: 'Insufficient funds.',
    ar: 'الرصيد غير كافٍ.',
  },
  LIMIT_EXCEEDED: {
    en: 'This transaction exceeds your limit.',
    ar: 'تتجاوز هذه العملية الحد المسموح به.',
  },
  KYC_REQUIRED: {
    en: 'Identity verification is required to continue.',
    ar: 'يلزم التحقق من الهوية للمتابعة.',
  },
  STEP_UP_REQUIRED: {
    en: 'Please confirm this action with your PIN or biometrics.',
    ar: 'يرجى تأكيد هذا الإجراء باستخدام الرمز السري أو البصمة.',
  },
  RISK_DECLINED: {
    en: 'This transaction was declined.',
    ar: 'تم رفض هذه العملية.',
  },
  RISK_REVIEW: {
    en: 'This transaction is under review.',
    ar: 'هذه العملية قيد المراجعة.',
  },
  ACCOUNT_FROZEN: {
    en: 'Your account is frozen.',
    ar: 'حسابك مجمّد.',
  },
  SERVICE_DISABLED: {
    en: 'This service is currently unavailable.',
    ar: 'هذه الخدمة غير متاحة حالياً.',
  },
  UPDATE_REQUIRED: {
    en: 'Please update the app to continue.',
    ar: 'يرجى تحديث التطبيق للمتابعة.',
  },
  MAINTENANCE: {
    en: 'The service is under maintenance. Please try again later.',
    ar: 'الخدمة قيد الصيانة. يرجى المحاولة لاحقاً.',
  },
  RATE_LIMITED: {
    en: 'Too many requests. Please try again later.',
    ar: 'طلبات كثيرة جداً. يرجى المحاولة لاحقاً.',
  },
  PARTNER_UNAVAILABLE: {
    en: 'A partner service is temporarily unavailable. Please try again later.',
    ar: 'خدمة الشريك غير متاحة مؤقتاً. يرجى المحاولة لاحقاً.',
  },
  INTERNAL_ERROR: {
    en: 'Something went wrong. Please try again later.',
    ar: 'حدث خطأ ما. يرجى المحاولة لاحقاً.',
  },
};

export function errorMessage(code: ErrorCode, locale: Locale): string {
  return ERROR_MESSAGES[code][locale];
}
