// Build-flavor feature flags. The Metro resolver (metro.config.js) swaps this
// module for ./features.foss when SLEEPCAST_FOSS=1, turning YouTube off for the
// F-Droid build. Varied-mix needs no flag — it's present in both flavors; only
// its embedder backend differs (see platform/embed vs platform/embed.foss).
export const YOUTUBE = true;
