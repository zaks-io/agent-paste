export type ApiErrorInfo = {
  status: number;
  code: string;
  message: string;
  requestId: string | undefined;
};

export type LoaderFallback<T> = {
  data: T | null;
  empty: boolean;
  error: ApiErrorInfo | null;
};

export type MutationResult<T> = { data: T; error: null } | { data: null; error: ApiErrorInfo };
