export function buildManagedAppId(repoUrl: string, branch?: string) {
  const normalized = repoUrl
    .replace(/\.git(?:#.*)?$/, '')
    .replace(/^https?:\/\//, '')
    .replace(/^git@/, '')
    .replace(/[:/]+/g, '-')
    .toLowerCase();

  return branch ? `${normalized}-${branch.replace(/[^a-z0-9-]/gi, '-').toLowerCase()}` : normalized;
}

export function getManagedAppName(repoUrl: string) {
  return repoUrl.split('/').slice(-1)[0].replace(/\.git(?:#.*)?$/, '');
}
