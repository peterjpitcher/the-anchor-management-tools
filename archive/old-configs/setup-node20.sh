#!/bin/bash

echo "=== Setting up Node.js v20 for Google Calendar Fix ==="
echo ""

# Add nvm to current shell
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"

# Use Node.js 20
echo "Switching to Node.js v20..."
nvm use 20

# Verify version
echo ""
echo "Current Node.js version:"
node --version

# Clean and reinstall
echo ""
echo "Cleaning and reinstalling dependencies..."
rm -rf node_modules package-lock.json
npm install

echo ""
echo "Testing Google Calendar sync..."
npx tsx scripts/test-calendar-sync.ts

echo ""
echo "=== Setup Complete ==="
echo ""
echo "To make this permanent, add this to your ~/.zshrc:"
echo ""
echo "# NVM configuration"
echo 'export NVM_DIR="$HOME/.nvm"'
echo '[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"'
echo ""
echo "Then in this project directory, run:"
echo "nvm use"