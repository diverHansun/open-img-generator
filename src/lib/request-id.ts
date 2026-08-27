export const REQUEST_ID_HEADER = 'X-Request-Id';

const REQUEST_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,63}$/;

type RequestWithHeaders = Pick<Request, 'headers'>;

export function isValidRequestId(value: unknown): value is string {
  return typeof value === 'string' && REQUEST_ID_PATTERN.test(value);
}

export function createRequestId(): string {
  return globalThis.crypto.randomUUID();
}

export function getRequestId(request?: RequestWithHeaders | null): string {
  const inbound = request?.headers.get(REQUEST_ID_HEADER);
  return isValidRequestId(inbound) ? inbound : createRequestId();
}

export function withRequestId<T extends Response>(
  response: T,
  requestId: string,
): T {
  response.headers.set(
    REQUEST_ID_HEADER,
    isValidRequestId(requestId) ? requestId : createRequestId(),
  );
  return response;
}
