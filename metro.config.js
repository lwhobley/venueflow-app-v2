const path = require('path');
require('./scripts/harden-metro-image-parsers');
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

const apiPath = path.join(__dirname, 'packages/api').replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');

config.resolver.blockList = [
  /(?:^|[\\/])packages[\\/]api[\\/].*/,
  new RegExp(`${apiPath}/.*`),
];

if (!config.resolver.assetExts.includes('wasm')) {
  config.resolver.assetExts.push('wasm');
}

// 3D stadium models
for (const ext of ['glb', 'gltf']) {
  if (!config.resolver.assetExts.includes(ext)) {
    config.resolver.assetExts.push(ext);
  }
}

// zustand's ESM build (resolved via package "exports" on web in SDK 54) uses
// `import.meta.env`, which ships a literal `import.meta` into the web bundle and
// throws "Cannot use 'import.meta' outside a module" when the browser loads it
// as a classic script. zustand's CJS build is import.meta-free, so resolve the
// CJS entry points explicitly. Scoped to zustand to avoid disabling package
// exports globally.
const zustandCjs = {
  zustand: path.resolve(__dirname, 'node_modules/zustand/index.js'),
  'zustand/middleware': path.resolve(__dirname, 'node_modules/zustand/middleware.js'),
  'zustand/shallow': path.resolve(__dirname, 'node_modules/zustand/shallow.js'),
};

const defaultResolveRequest = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName === 'decode-uri-component') {
    return { type: 'sourceFile', filePath: path.resolve(__dirname, 'scripts/safe-uri-decode.cjs') };
  }
  const cjsTarget = zustandCjs[moduleName];
  if (cjsTarget) {
    return { type: 'sourceFile', filePath: cjsTarget };
  }
  if (defaultResolveRequest) {
    return defaultResolveRequest(context, moduleName, platform);
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
