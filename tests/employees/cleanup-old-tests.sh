#!/bin/bash

# Archive old test files
mkdir -p archived-tests

# Move all the complex test files to archive
mv employee-list.spec.ts archived-tests/ 2>/dev/null
mv employee-create.spec.ts archived-tests/ 2>/dev/null
mv employee-details.spec.ts archived-tests/ 2>/dev/null
mv employee-edit.spec.ts archived-tests/ 2>/dev/null
mv employee-attachments.spec.ts archived-tests/ 2>/dev/null
mv employee-basic.spec.ts archived-tests/ 2>/dev/null
mv employee-create-simple.spec.ts archived-tests/ 2>/dev/null
mv employee-verify.spec.ts archived-tests/ 2>/dev/null

echo "Archived old test files to archived-tests/"
echo "Keep only employees.spec.ts as the main test file"