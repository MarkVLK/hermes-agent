const { getDefaultConfig } = require('expo/metro-config');
const fs = require('fs');
const path = require('path');

const config = getDefaultConfig(__dirname);

// This app lives in an npm workspace whose root node_modules can hold
// hoisted (or stale) copies of React/React Native/Expo packages from other
// workspaces' installs. If Metro bundles two copies of a native module, the
// app crashes in Expo Go with "Tried to register two views with the same
// name ..." (and duplicated React breaks hooks). Whenever this app has its
// own copy of such a package, force resolution to it.
const APP_NODE_MODULES = path.join(__dirname, 'node_modules');
const PINNED = /^(react|react-dom|react-native|scheduler|expo|expo-[\w-]+|@expo\/[\w-]+|react-native-[\w-]+|@react-navigation\/[\w-]+|@react-native\/[\w-]+)(\/|$)/;

const priorResolveRequest = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (PINNED.test(moduleName)) {
    const pkg = moduleName.startsWith('@')
      ? moduleName.split('/').slice(0, 2).join('/')
      : moduleName.split('/')[0];
    if (fs.existsSync(path.join(APP_NODE_MODULES, pkg))) {
      context = { ...context, originModulePath: path.join(__dirname, 'package.json') };
    }
  }
  const resolve = priorResolveRequest ?? context.resolveRequest;
  return resolve(context, moduleName, platform);
};

module.exports = config;
