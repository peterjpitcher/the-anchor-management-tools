export type MileageReportErrorCode =
  | 'MILEAGE_FORBIDDEN'
  | 'MILEAGE_REPORT_INVALID_RANGE'
  | 'MILEAGE_REPORT_TOO_LARGE'
  | 'MILEAGE_REPORT_QUERY_FAILED'
  | 'MILEAGE_REPORT_RENDER_FAILED'

/** Plain wording shown to the user (spec 7.3). */
export const MILEAGE_REPORT_ERROR_MESSAGES: Record<MileageReportErrorCode, string> = {
  MILEAGE_FORBIDDEN: "You don't have access to mileage reports.",
  MILEAGE_REPORT_INVALID_RANGE: 'Choose valid dates for the report.',
  MILEAGE_REPORT_TOO_LARGE: 'This period is too large for one report. Choose shorter dates.',
  MILEAGE_REPORT_QUERY_FAILED: "Couldn't load the mileage data. Nothing was downloaded. Try again.",
  MILEAGE_REPORT_RENDER_FAILED: "Couldn't build the PDF. Nothing was downloaded. Try again.",
}

export const MILEAGE_REPORT_ERROR_STATUS: Record<MileageReportErrorCode, number> = {
  MILEAGE_FORBIDDEN: 403,
  MILEAGE_REPORT_INVALID_RANGE: 400,
  MILEAGE_REPORT_TOO_LARGE: 413,
  MILEAGE_REPORT_QUERY_FAILED: 500,
  MILEAGE_REPORT_RENDER_FAILED: 500,
}

export class MileageReportError extends Error {
  constructor(
    public readonly code: MileageReportErrorCode,
    message: string = MILEAGE_REPORT_ERROR_MESSAGES[code]
  ) {
    super(message)
    this.name = 'MileageReportError'
  }
}
