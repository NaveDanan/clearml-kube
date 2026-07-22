#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const hookPath = path.join('.git', 'hooks', 'pre-commit');
const hookContent = `#!/bin/sh
# pre-commit hook to prevent committing DB files
npm run check:no-db
exit $?`

try {
  // Ensure .git/hooks directory exists
  fs.mkdirSync('.git/hooks', { recursive: true });
  fs.writeFileSync(hookPath, hookContent, { mode: 0o755 });
  console.log('Pre-commit hook installed at .git/hooks/pre-commit');
} catch (err) {
  console.error('Failed to install pre-commit hook. Run this script from the repo root.');
  console.error(err.message || err);
  process.exit(1);
}
