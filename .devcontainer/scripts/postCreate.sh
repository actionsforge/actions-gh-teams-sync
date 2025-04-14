#!/bin/bash

set -e

if [ -f "package.json" ]; then
  npm install
  npm run build
fi
