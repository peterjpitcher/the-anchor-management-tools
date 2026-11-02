// Right to work scan paths (FF-32). The save refuses any path with "..", so the name it is
// stored under must never contain one, or the scan uploads, is refused and is left in storage.
import { describe, expect, it } from 'vitest'
import {
  isRightToWorkStoragePath,
  rightToWorkStoragePath,
  sanitiseStorageFileName,
} from '@/lib/employees/document-rules'

const EMPLOYEE_ID = '00000000-0000-4000-8000-000000000001'

describe('right to work storage paths', () => {
  it.each(['passport..pdf', 'Scan...jpg', 'J..Smith passport.png'])(
    'stores %s under a path the save accepts',
    (fileName) => {
      const path = rightToWorkStoragePath(EMPLOYEE_ID, fileName, 1_700_000_000_000)

      expect(path).not.toContain('..')
      expect(isRightToWorkStoragePath(EMPLOYEE_ID, path)).toBe(true)
    },
  )

  it('keeps an ordinary name as it was', () => {
    expect(sanitiseStorageFileName('passport scan.pdf', 'fallback')).toBe('passport_scan.pdf')
  })

  it('refuses a path to another file in the employee folder', () => {
    expect(isRightToWorkStoragePath(EMPLOYEE_ID, `${EMPLOYEE_ID}/contract.pdf`)).toBe(false)
    expect(isRightToWorkStoragePath(EMPLOYEE_ID, `${EMPLOYEE_ID}/rtw_1_../other.pdf`)).toBe(false)
  })
})
