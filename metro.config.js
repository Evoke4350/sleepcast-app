const { getDefaultConfig, mergeConfig } = require('@react-native/metro-config');

/**
 * Metro configuration
 * https://reactnative.dev/docs/metro
 *
 * @type {import('@react-native/metro-config').MetroConfig}
 */
const defaultConfig = getDefaultConfig(__dirname);

const config = {
  resolver: {
    // .onnx (MiniLM model) and .txt (its vocab) ship as bundled assets.
    assetExts: [...defaultConfig.resolver.assetExts, 'onnx', 'txt'],
  },
};

module.exports = mergeConfig(defaultConfig, config);
