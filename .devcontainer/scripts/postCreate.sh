#!/bin/bash
set -e

if [ -f "package.json" ]; then
  echo "📦 Installing dependencies..."
  npm ci

  echo "🔨 Building action..."
  npm run build

  echo "🔍 Type checking..."
  npm run build

  echo "📝 Linting..."
  npm run lint

  echo "🔒 Security audit..."
  npm audit

  # Set environment variables for tests
  export GITHUB_TOKEN=test-token
  export GITHUB_REPOSITORY=example-org/example-repo
  export GITHUB_ORG=test-org

  echo "🧪 Running tests..."
  npm test

  echo "📊 Test coverage..."
  npm test -- --coverage

  echo "✅ Build verification..."
  test -f dist/sync-teams.js

  echo "📦 Checking dependencies..."
  npm outdated
fi
