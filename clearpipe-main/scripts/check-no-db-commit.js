#!/usr/bin/env node
const { execSync } = require('child_process');

try {
  const staged = execSync('git diff --cached --name-only', { encoding: 'utf8' });
  const stagedFiles = staged.split(/\r?\n/).filter(Boolean);
  const forbidden = stagedFiles.find((f) => /\.db\.json$/i.test(f));
  if (forbidden) {
    console.error(`ERROR: Attempting to commit a DB file: '${forbidden}'.\nPlease unstage and remove DB files before committing.`);
    process.exit(1);
  }
  process.exit(0);
} catch (err) {
  console.error('Failed to check staged files for DB patterns:', err.message || err);
  process.exit(0);
}
