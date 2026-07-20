import type { TranslationKey } from '@/lib/i18n';
import { ApiClientError } from '@/lib/web-client';

export type GenerateOperation = 'submit' | 'detail' | 'cancel' | 'bootstrap';
export type GenerateErrorAction =
  | 'configure-providers'
  | 'check-history'
  | 'reload'
  | 'back-to-compose'
  | 'wait'
  | 'none';

export type GenerateErrorPresentation = {
  messageKey: TranslationKey;
  action: GenerateErrorAction;
  requestId?: string;
  retryAfterSeconds?: number;
};

export type GenerateErrorActionHandlers = Partial<
  Record<Exclude<GenerateErrorAction, 'none'>, () => void>
>;

export function getGenerateErrorActionLabelKey(
  action: GenerateErrorAction,
): TranslationKey | null {
  switch (action) {
    case 'configure-providers':
      return 'generate.error.action.configureProviders';
    case 'check-history':
      return 'generate.error.action.checkHistory';
    case 'reload':
      return 'generate.error.action.reload';
    case 'back-to-compose':
      return 'generate.error.action.backToCompose';
    case 'wait':
      return 'generate.error.action.retry';
    case 'none':
      return null;
  }
}

export function dispatchGenerateErrorAction(
  action: GenerateErrorAction,
  handlers: GenerateErrorActionHandlers,
): boolean {
  if (action === 'none') return false;
  const handler = handlers[action];
  if (!handler) return false;
  handler();
  return true;
}

function unknownPresentation(
  operation: GenerateOperation,
): Pick<GenerateErrorPresentation, 'messageKey' | 'action'> {
  if (operation === 'submit') {
    return {
      messageKey: 'generate.error.outcomeUnknown',
      action: 'check-history',
    };
  }
  if (operation === 'bootstrap') {
    return {
      messageKey: 'generate.error.serviceUnavailable',
      action: 'reload',
    };
  }
  return {
    messageKey: 'generate.error.serviceUnavailable',
    action: operation === 'detail' ? 'check-history' : 'none',
  };
}

export function mapGenerateError(
  cause: unknown,
  operation: GenerateOperation,
): GenerateErrorPresentation {
  const error = cause instanceof ApiClientError ? cause : null;
  let presentation: Pick<GenerateErrorPresentation, 'messageKey' | 'action'>;

  switch (error?.code) {
    case 'VALIDATION_ERROR':
    case 'INVALID_JSON':
    case 'PAYLOAD_TOO_LARGE':
      presentation = {
        messageKey: 'generate.error.validation',
        action: 'none',
      };
      break;
    case 'CONFIGURATION_UNAVAILABLE':
    case 'CREDENTIAL_MANAGED_BY_ENV':
      presentation = {
        messageKey: 'generate.error.configuration',
        action: 'configure-providers',
      };
      break;
    case 'RATE_LIMITED':
    case 'QUEUE_SATURATED':
      presentation = {
        messageKey: 'generate.error.rateLimited',
        action: 'wait',
      };
      break;
    case 'SCHEMA_NOT_READY':
    case 'DATABASE_UNAVAILABLE':
    case 'INITIAL_SESSION_UNAVAILABLE':
      presentation = {
        messageKey: 'generate.error.serviceUnavailable',
        action: 'wait',
      };
      break;
    case 'AUTHENTICATION_REQUIRED':
      presentation = {
        messageKey: 'generate.error.authentication',
        action: 'reload',
      };
      break;
    case 'NOT_FOUND':
      presentation = {
        messageKey: 'generate.error.notFound',
        action: 'back-to-compose',
      };
      break;
    case 'IDEMPOTENCY_KEY_REUSED':
    case 'INTERNAL_ERROR':
      presentation = unknownPresentation(operation);
      break;
    default:
      presentation = unknownPresentation(operation);
  }

  return {
    ...presentation,
    requestId: error?.requestId,
    retryAfterSeconds:
      error?.retryAfterMs === undefined
        ? undefined
        : Math.ceil(error.retryAfterMs / 1_000),
  };
}
