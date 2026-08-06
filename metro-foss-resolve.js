const path = require('path');

// FOSS build swap: when SLEEPCAST_FOSS=1, rewrite three modules to their .foss
// siblings so the bundle contains the pure-JS embedder + YouTube stub instead of
// onnxruntime + the 23 MB model + the webview/youtube-iframe player. This module
// lives at the repo root, so __dirname is the project root and each swap target
// is matched by EXACT absolute path — no suffix match, so no unrelated file
// (e.g. a node_modules path ending in src/features.ts) can collide.
// See docs/specs/2026-08-06-fdroid-flavor-design.md.
//
// Kept in its own plain-JS module (no metro-config import) so it is unit-testable
// under Jest — requiring metro.config.js directly pulls untransformed Flow.
const ROOT = __dirname;
const FOSS_SWAPS = [
  [path.join(ROOT, 'src', 'features.ts'), path.join(ROOT, 'src', 'features.foss.ts')],
  [path.join(ROOT, 'src', 'platform', 'embed.ts'), path.join(ROOT, 'src', 'platform', 'embed.foss.ts')],
  [path.join(ROOT, 'src', 'youtube', 'YouTubePlayer.tsx'), path.join(ROOT, 'src', 'youtube', 'YouTubePlayer.foss.tsx')],
];

function fossResolveRequest(context, moduleName, platform) {
  const res = context.resolveRequest(context, moduleName, platform);
  if (process.env.SLEEPCAST_FOSS === '1' && res && res.type === 'sourceFile') {
    for (const [from, to] of FOSS_SWAPS) {
      if (res.filePath === from) {
        return { ...res, filePath: to };
      }
    }
  }
  return res;
}

module.exports = { fossResolveRequest, FOSS_SWAPS };
