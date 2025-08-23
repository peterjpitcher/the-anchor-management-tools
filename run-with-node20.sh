#!/bin/bash

# This script runs commands with Node.js v20

# Use Node.js v20 from nvm
NODE_PATH="$HOME/.nvm/versions/node/v20.19.3/bin"

# Add Node.js v20 to PATH for this script
export PATH="$NODE_PATH:$PATH"

# Verify we're using Node.js v20
echo "Using Node.js version: $(node --version)"

# Run the command passed as arguments
"$@"