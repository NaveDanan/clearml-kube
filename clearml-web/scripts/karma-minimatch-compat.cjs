'use strict';

// Karma 6 expects the legacy callable CommonJS export from minimatch.
// Security-patched minimatch releases expose a module object instead. Adapt
// that export only inside test-runner processes until Karma supports it.
const Module = require('node:module');
const originalLoad = Module._load;

Module._load = function loadWithMinimatchCompatibility(request, parent, isMain) {
  const loaded = originalLoad.call(this, request, parent, isMain);

  if (
    request === 'minimatch' &&
    typeof loaded !== 'function' &&
    typeof loaded.minimatch === 'function'
  ) {
    return Object.assign(loaded.minimatch, loaded);
  }

  return loaded;
};
