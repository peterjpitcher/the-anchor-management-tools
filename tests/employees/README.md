# Employee Management Tests

This directory contains comprehensive end-to-end tests for the employee management module.

## Test Coverage

### 1. **Employee List** (`employee-list.spec.ts`)
- ✅ Display employee list page
- ✅ Search functionality
- ✅ Filter by status (All/Active/Former)
- ✅ Navigation to add employee
- ✅ Export modal functionality
- ✅ Empty state handling
- ✅ Click to view employee details

### 2. **Employee Create** (`employee-create.spec.ts`)
- ✅ Display create form with all fields
- ✅ Required field validation
- ✅ Successful employee creation
- ✅ Cancel functionality
- ✅ Email format validation
- ✅ Former employee with end date

### 3. **Employee Details** (`employee-details.spec.ts`)
- ✅ Display all tabs (Details, Emergency Contacts, Financial, Health, Version History)
- ✅ View personal information
- ✅ Add emergency contacts
- ✅ Add financial details
- ✅ Add health records
- ✅ Add notes
- ✅ Navigate to edit page

### 4. **Employee Edit** (`employee-edit.spec.ts`)
- ✅ Display edit form with existing data
- ✅ Update personal details
- ✅ Update financial details via tab
- ✅ Update health records via tab
- ✅ Change employee status
- ✅ Cancel changes
- ✅ Required field validation

### 5. **Employee Attachments** (`employee-attachments.spec.ts`)
- ✅ Display attachments section
- ✅ Open upload modal
- ✅ Upload single document
- ✅ Upload multiple document types
- ✅ Handle upload errors
- ✅ Delete attachments
- ✅ Display file metadata

## Running the Tests

### Run all employee tests:
```bash
npx playwright test tests/employees/
```

### Run specific test file:
```bash
npx playwright test tests/employees/employee-list.spec.ts
```

### Run with UI mode for debugging:
```bash
npx playwright test tests/employees/ --ui
```

### Run in headed mode:
```bash
npx playwright test tests/employees/ --headed
```

## Test Data

All test data is prefixed with `[PLAYWRIGHT_TEST]` for easy identification and cleanup:
- Employee names: `[PLAYWRIGHT_TEST] Test Employee`
- Email addresses: `playwright.test.{timestamp}@example.com`
- Phone numbers: `07700900xxx` (UK test range)

## Cleanup

Test employees are created during test runs. To clean them up:

1. **Manual cleanup**: Search for "[PLAYWRIGHT_TEST]" in the employee list and delete
2. **Automated cleanup**: Use the cleanup helper (if implemented)

## Known Issues & Limitations

1. **File Upload Tests**: 
   - Creates actual files in Supabase storage
   - Files are small text files to minimize storage impact

2. **Version History Tests**: 
   - Not yet implemented (complex to test restoration)

3. **Performance**: 
   - Full suite takes ~2-3 minutes to run
   - Each test creates real database records

## Future Enhancements

- [ ] Test employee schedule management
- [ ] Test bulk operations
- [ ] Test CSV/JSON export download
- [ ] Test version history restoration
- [ ] Test permission-based access (different roles)
- [ ] Add visual regression tests
- [ ] Test error states more thoroughly

## Debugging Tips

1. **Screenshots**: Check `tests/screenshots/` for visual debugging
2. **Videos**: Failed tests save videos in `test-results/`
3. **Traces**: Use `--trace on` to record detailed traces
4. **Console**: Add `console.log()` statements to debug
5. **Pause**: Use `await page.pause()` to stop execution

## Best Practices

1. Always use the `TEST_DATA.prefix` for test data
2. Clean up created resources when possible
3. Use explicit waits instead of arbitrary timeouts
4. Take screenshots at key points for debugging
5. Test both happy paths and error cases
6. Keep tests independent - don't rely on other tests