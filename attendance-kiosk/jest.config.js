module.exports = {
  preset: '@react-native/jest-preset',
  // The default preset skips transforming anything in node_modules, but
  // several RN ecosystem packages (async-storage among them) ship ES module
  // syntax that Jest's runtime cannot execute untransformed. This allowlists
  // exactly the packages this app actually imports that need it, rather
  // than transforming all of node_modules (slow, and unnecessary for
  // packages that already ship CommonJS).
  transformIgnorePatterns: [
    'node_modules/(?!(@react-native|react-native|@react-navigation|react-native-vision-camera|@react-native-async-storage)/)',
  ],
};