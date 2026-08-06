const path = require('path');

// FOSS build swap: when SLEEPCAST_FOSS=1, rewrite three modules to their .foss
// siblings so the bundle contains the pure-JS embedder + YouTube stub instead of
// onnxruntime + the 23 MB model + the webview/youtube-iframe player. Matching is
// on the resolved absolute path suffix, so every importer's relative path is
// covered. See docs/specs/2026-08-06-fdroid-flavor-design.md.
//
// Kept in its own plain-JS module (no metro-config import) so it is unit-testable
// under Jest — requiring metro.config.js directly pulls untransformed Flow.
const FOSS_SWAPS = [
  [path.join('src', 'features.ts'), path.join('src', 'features.foss.ts')],
  [path.join('src', 'platform', 'embed.ts'), path.join('src', 'platform', 'embed.foss.ts')],
  [path.join('src', 'youtube', 'YouTubePlayer.tsx'), path.join('src', 'youtube', 'YouTubePlayer.foss.tsx')],
];

function fossResolveRequest(context, moduleName, platform) {
  const res = context.resolveRequest(context, moduleName, platform);
  if (process.env.SLEEPCAST_FOSS === '1' && res && res.type === 'sourceFile') {
    for (const [from, to] of FOSS_SWAPS) {
      if (res.filePath.endsWith(from)) {
        return { ...res, filePath: res.filePath.slice(0, -from.length) + to };
      }
    }
  }
  return res;
}

module.exports = { fossResolveRequest, FOSS_SWAPS };
