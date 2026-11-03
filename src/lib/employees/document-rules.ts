/**
 * The file rules for employee documents: which files the attachment and right to work uploads
 * take, and how a file is named in storage. The staff forms, the new employee form, the server
 * actions and EmployeeService each carried their own copy of these lists and of the file name
 * cleaner, so a type allowed in one place could be refused in the next.
 *
 * Pure functions only: no Supabase, safe to import from client components.
 */

const EMPLOYEE_ATTACHMENT_MIME_TYPES = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/tiff',
  'image/tif',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'text/plain',
] as const;

/** The file picker's accept list for attachments. */
export const EMPLOYEE_ATTACHMENT_ACCEPT = '.pdf,.png,.jpg,.jpeg,.tif,.tiff,.doc,.docx,.txt';

export const EMPLOYEE_ATTACHMENT_TYPE_MESSAGE =
  'Invalid file type. Only PDF, Word, JPG, PNG, TIFF, and TXT files are allowed.';

const RIGHT_TO_WORK_MIME_TYPES = ['application/pdf', 'image/jpeg', 'image/png'] as const;

/** The file picker's accept list for a right to work scan. */
export const RIGHT_TO_WORK_ACCEPT = '.pdf,.jpg,.jpeg,.png';

export const RIGHT_TO_WORK_TYPE_MESSAGE = 'Only PDF, JPG, and PNG files are allowed.';

export function isAllowedAttachmentType(mimeType: string): boolean {
  return (EMPLOYEE_ATTACHMENT_MIME_TYPES as readonly string[]).includes(mimeType);
}

export function isAllowedRightToWorkType(mimeType: string): boolean {
  return (RIGHT_TO_WORK_MIME_TYPES as readonly string[]).includes(mimeType);
}

/**
 * Keeps letters, digits, dots, dashes and underscores, so the name is safe as a storage key. Runs
 * of dots become one: isRightToWorkStoragePath refuses any path with "..", so "passport..pdf"
 * used to upload, then be refused on save and left behind in storage.
 */
export function sanitiseStorageFileName(name: string, fallback: string): string {
  const sanitised = name
    .replace(/[^\w\s.-]/g, '')
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    .replace(/\.{2,}/g, '.')
    .replace(/^[._-]+|[._-]+$/g, '');

  return sanitised || fallback;
}

const RIGHT_TO_WORK_FILE_PREFIX = 'rtw_';

/** Where a right to work scan is stored: `<employee id>/rtw_<time>_<file name>`. */
export function rightToWorkStoragePath(employeeId: string, fileName: string, now: number = Date.now()): string {
  return `${employeeId}/${RIGHT_TO_WORK_FILE_PREFIX}${now}_${sanitiseStorageFileName(fileName, 'right_to_work_document')}`;
}

/**
 * True only for a path this employee's right to work upload could have produced. The save
 * action is handed the path by the browser, so a path to another file in the employee's folder
 * (one of their attachments, say) must not be accepted as their right to work scan.
 */
export function isRightToWorkStoragePath(employeeId: string, path: string): boolean {
  const prefix = `${employeeId}/${RIGHT_TO_WORK_FILE_PREFIX}`;
  if (!path.startsWith(prefix)) return false;
  const rest = path.slice(prefix.length);
  return rest.length > 0 && !rest.includes('/') && !rest.includes('..');
}

/** The name a downloaded right to work scan is saved under: its original name, without the storage prefix. */
export function rightToWorkDownloadName(path: string): string {
  const fileName = path.split('/').pop() ?? '';
  const withoutPrefix = fileName.replace(/^rtw_\d+_/, '');
  return withoutPrefix || 'right_to_work_document';
}
