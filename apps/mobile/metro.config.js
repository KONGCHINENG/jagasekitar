// Monorepo: the web portal pins newer React/React Native at the repo root, and packages hoisted
// there would otherwise resolve those copies. Two Reacts in one bundle crash the app ("Invalid
// hook call"), and a React Native newer than Expo Go's breaks at runtime. Force every import of
// these packages to the app's own copies, matching the installed Expo SDK.
const { getDefaultConfig } = require('expo/metro-config');
const path = require('node:path');

const config = getDefaultConfig(__dirname);

const SINGLETONS = [
  'react',
  'react-dom',
  'react-native',
  'react-native-reanimated',
  'react-native-worklets',
  'react-native-gesture-handler',
  'react-native-safe-area-context',
  'react-native-screens',
];
const fromApp = path.join(__dirname, 'package.json');
const isSingleton = (name) => SINGLETONS.some((s) => name === s || name.startsWith(`${s}/`));

config.resolver.resolveRequest = (context, moduleName, platform) =>
  context.resolveRequest(
    isSingleton(moduleName) ? { ...context, originModulePath: fromApp } : context,
    moduleName,
    platform,
  );

module.exports = config;
