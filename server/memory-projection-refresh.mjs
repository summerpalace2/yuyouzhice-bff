// Java owns synthesis; refresh only images last written by the old generator.
export function shouldRefreshMemoryProjection(metadata = {}) {
  const generated = Number(metadata.promptLastSynthesizedAt || 0);
  return Number(metadata.memoryProjectionVersion || 0) < 1
    && generated > 0 && generated >= Number(metadata.promptLastEditedAt || 0);
}

export async function readPreferencesWithCurrentProjection(requestJava, token, signal) {
  let preferences = await requestJava('/ai/preferences', { token, signal });
  if (shouldRefreshMemoryProjection(preferences?.legacyMetadata)) {
    await requestJava('/ai/memories/prepend-prompt', { token, signal });
    preferences = await requestJava('/ai/preferences', { token, signal });
  }
  return preferences;
}
