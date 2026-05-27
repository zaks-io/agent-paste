export function revisionPurgePrefix(artifactId: string, revisionId: string): string {
  return `artifacts/${artifactId}/revisions/${revisionId}/`;
}
