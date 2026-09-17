/** Matches backend sapImportInFlightGuard error code. */
export const SAP_IMPORT_IN_PROGRESS_CODE = 'SAP_IMPORT_IN_PROGRESS';

export const SAP_IMPORT_IN_PROGRESS_MESSAGE =
  'SAP import is still running. Wait until it finishes before uploading Daily Planning or WB.';

export function isSapImportInProgressError(err: unknown): boolean {
  const code = (err as { response?: { data?: { error?: { code?: string } } } })?.response?.data?.error?.code;
  return code === SAP_IMPORT_IN_PROGRESS_CODE;
}

export function sapImportInProgressErrorMessage(err: unknown): string {
  if (isSapImportInProgressError(err)) {
    const msg = (err as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error
      ?.message;
    return msg || SAP_IMPORT_IN_PROGRESS_MESSAGE;
  }
  return '';
}
