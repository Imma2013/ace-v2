import React, { useState, useEffect, useMemo, useRef } from 'react';
import { motion } from 'framer-motion';
import { Button } from '~/components/ui/Button';
import { Input } from '~/components/ui/Input';
import { BranchSelector } from '~/components/ui/BranchSelector';
import { GitHubRepositoryCard } from './GitHubRepositoryCard';
import type { GitHubRepoInfo } from '~/types/GitHub';
import { useGitHubConnection, useGitHubStats } from '~/lib/hooks';
import { classNames } from '~/utils/classNames';
import { Search, RefreshCw, GitBranch, Calendar, Filter, Link as LinkIcon, Github, Clipboard, Check } from 'lucide-react';

interface GitHubRepositorySelectorProps {
  onClone?: (repoUrl: string, branch?: string) => void;
  className?: string;
}

type SortOption = 'updated' | 'stars' | 'name' | 'created';
type FilterOption = 'all' | 'own' | 'forks' | 'archived';

const extractGitHubRepoNameFromUrl = (url: string): string | null => {
  const trimmed = url.trim();
  const sshMatch = trimmed.match(/^git@github\.com:([^/]+)\/([^/#?]+?)(?:\.git)?$/i);

  if (sshMatch) {
    return sshMatch[2];
  }

  const httpsMatch = trimmed.match(
    /github\.com[:/]([^/]+)\/([^/#?]+?)(?:\.git)?(?:\/tree\/[^?#]+)?\/?(?:[?#].*)?$/i,
  );

  return httpsMatch ? httpsMatch[2] : null;
};

export function GitHubRepositorySelector({ onClone, className }: GitHubRepositorySelectorProps) {
  const { connection, isConnected, isConnecting: isDeviceConnecting, startDeviceFlow, deviceFlow, cancelDeviceFlow } =
    useGitHubConnection();
  const [codeCopied, setCodeCopied] = useState(false);
  const wasDisconnectedRef = useRef(!isConnected);
  const {
    stats,
    isLoading: isStatsLoading,
    refreshStats,
  } = useGitHubStats(connection, {
    autoFetch: true,
    cacheTimeout: 30 * 60 * 1000,
  });

  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState<SortOption>('updated');
  const [filterBy, setFilterBy] = useState<FilterOption>('all');
  const [currentPage, setCurrentPage] = useState(1);
  const [selectedRepo, setSelectedRepo] = useState<GitHubRepoInfo | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isBranchSelectorOpen, setIsBranchSelectorOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [repoUrl, setRepoUrl] = useState('');
  const [urlError, setUrlError] = useState<string | null>(null);

  const repositories = stats?.repos || [];
  const REPOS_PER_PAGE = 12;

  const filteredRepositories = useMemo(() => {
    if (!repositories) {
      return [];
    }

    const filtered = repositories.filter((repo: GitHubRepoInfo) => {
      const matchesSearch =
        !searchQuery ||
        repo.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        repo.description?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        repo.full_name.toLowerCase().includes(searchQuery.toLowerCase());

      let matchesFilter = true;

      switch (filterBy) {
        case 'own':
          matchesFilter = !repo.fork;
          break;
        case 'forks':
          matchesFilter = repo.fork === true;
          break;
        case 'archived':
          matchesFilter = repo.archived === true;
          break;
        case 'all':
        default:
          matchesFilter = true;
          break;
      }

      return matchesSearch && matchesFilter;
    });

    filtered.sort((a: GitHubRepoInfo, b: GitHubRepoInfo) => {
      switch (sortBy) {
        case 'name':
          return a.name.localeCompare(b.name);
        case 'stars':
          return b.stargazers_count - a.stargazers_count;
        case 'created':
          return new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime();
        case 'updated':
        default:
          return new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime();
      }
    });

    return filtered;
  }, [repositories, searchQuery, sortBy, filterBy]);

  const totalPages = Math.ceil(filteredRepositories.length / REPOS_PER_PAGE);
  const startIndex = (currentPage - 1) * REPOS_PER_PAGE;
  const currentRepositories = filteredRepositories.slice(startIndex, startIndex + REPOS_PER_PAGE);

  const handleRefresh = async () => {
    setIsRefreshing(true);
    setError(null);

    try {
      await refreshStats();
    } catch (err) {
      console.error('Failed to refresh GitHub repositories:', err);
      setError(err instanceof Error ? err.message : 'Failed to refresh repositories');
    } finally {
      setIsRefreshing(false);
    }
  };

  const handleCloneRepository = (repo: GitHubRepoInfo) => {
    setSelectedRepo(repo);
    setIsBranchSelectorOpen(true);
  };

  const handleBranchSelect = (branch: string) => {
    if (onClone && selectedRepo) {
      const cloneUrl = `${selectedRepo.html_url}.git`;
      onClone(cloneUrl, branch);
    }

    setSelectedRepo(null);
  };

  const handleCloseBranchSelector = () => {
    setIsBranchSelectorOpen(false);
    setSelectedRepo(null);
  };

  const handleCloneFromUrl = () => {
    const trimmedUrl = repoUrl.trim();

    if (!trimmedUrl) {
      setUrlError('Enter a GitHub repository URL.');
      return;
    }

    if (!extractGitHubRepoNameFromUrl(trimmedUrl)) {
      setUrlError('Invalid GitHub URL. Expected github.com/owner/repo.');
      return;
    }

    setUrlError(null);
    onClone?.(trimmedUrl);
  };

  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery, sortBy, filterBy]);

  useEffect(() => {
    if (isConnected && wasDisconnectedRef.current) {
      wasDisconnectedRef.current = false;
      void refreshStats();
    }

    if (!isConnected) {
      wasDisconnectedRef.current = true;
    }
  }, [isConnected, refreshStats]);

  return (
    <motion.div
      className={classNames('space-y-6', className)}
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
    >
      <div className="rounded-xl border border-bolt-elements-borderColor bg-bolt-elements-background-depth-1 p-4 space-y-3">
        <div className="flex items-center gap-2">
          <LinkIcon className="w-4 h-4 text-bolt-elements-textSecondary" />
          <h3 className="text-lg font-semibold text-bolt-elements-textPrimary">Import From GitHub URL</h3>
        </div>
        <p className="text-sm text-bolt-elements-textSecondary">
          Paste any public or accessible GitHub repo URL. Branch URLs like `/tree/main` are supported.
        </p>
        <div className="flex flex-col sm:flex-row gap-3">
          <Input
            value={repoUrl}
            onChange={(e) => {
              setRepoUrl(e.target.value);
              if (urlError) {
                setUrlError(null);
              }
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                handleCloneFromUrl();
              }
            }}
            placeholder="https://github.com/owner/repo or git@github.com:owner/repo.git"
            className="flex-1"
          />
          <Button onClick={handleCloneFromUrl} className="sm:self-start">
            Import URL
          </Button>
        </div>
        {urlError && <p className="text-sm text-red-500">{urlError}</p>}
      </div>

      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold text-bolt-elements-textPrimary">Browse Connected Repositories</h3>
          <p className="text-sm text-bolt-elements-textSecondary">
            {isConnected && connection
              ? `${filteredRepositories.length} of ${repositories.length} repositories`
              : 'Connect your GitHub account to browse and import your repositories.'}
          </p>
        </div>
        {isConnected && connection && (
          <Button
            onClick={handleRefresh}
            disabled={isRefreshing}
            variant="outline"
            size="sm"
            className="flex items-center gap-2"
          >
            <RefreshCw className={classNames('w-4 h-4', { 'animate-spin': isRefreshing })} />
            Refresh
          </Button>
        )}
      </div>

      {!isConnected || !connection ? (
        <div className="rounded-xl border border-dashed border-bolt-elements-borderColor p-6 space-y-4">
          {!deviceFlow ? (
            <div className="text-center space-y-4">
              <Github className="w-12 h-12 text-bolt-elements-textTertiary mx-auto" />
              <p className="text-bolt-elements-textSecondary">
                Connect your GitHub account to browse and import your repositories.
              </p>
              <Button
                onClick={() => void startDeviceFlow()}
                disabled={isDeviceConnecting}
                className="gap-2"
              >
                {isDeviceConnecting ? (
                  <>
                    <div className="animate-spin w-4 h-4 border-2 border-current border-t-transparent rounded-full" />
                    Starting...
                  </>
                ) : (
                  <>
                    <Github className="w-4 h-4" />
                    Connect with GitHub
                  </>
                )}
              </Button>
              <p className="text-xs text-bolt-elements-textTertiary">
                Uses GitHub device flow. Requires <code className="px-1 py-0.5 rounded bg-bolt-elements-background-depth-3 text-xs">GITHUB_CLIENT_ID</code> in your environment.
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="text-center">
                <p className="text-sm font-medium text-bolt-elements-textPrimary mb-1">Enter this code on GitHub</p>
                <div className="inline-flex items-center gap-2 rounded-lg border border-bolt-elements-borderColor bg-bolt-elements-background-depth-3 px-4 py-3">
                  <span className="font-mono text-xl tracking-[0.3em] text-bolt-elements-textPrimary">
                    {deviceFlow.userCode}
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      navigator.clipboard.writeText(deviceFlow.userCode).then(() => {
                        setCodeCopied(true);
                        setTimeout(() => setCodeCopied(false), 2000);
                      });
                    }}
                    className="p-1 rounded hover:bg-bolt-elements-background-depth-1 transition-colors"
                    title="Copy code"
                  >
                    {codeCopied ? (
                      <Check className="w-4 h-4 text-green-500" />
                    ) : (
                      <Clipboard className="w-4 h-4 text-bolt-elements-textSecondary" />
                    )}
                  </button>
                </div>
              </div>

              <div className="rounded-lg border border-bolt-elements-borderColor bg-bolt-elements-background-depth-1 p-3 text-sm text-bolt-elements-textSecondary space-y-1">
                <p>{deviceFlow.message || 'Approve this login on GitHub to finish connecting.'}</p>
                <p>
                  Visit{' '}
                  <a
                    href={deviceFlow.verificationUriComplete || deviceFlow.verificationUri}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-bolt-elements-borderColorActive hover:underline"
                  >
                    {deviceFlow.verificationUri}
                  </a>{' '}
                  and enter the code above.
                </p>
              </div>

              <div className="flex items-center justify-center gap-3">
                <Button
                  onClick={() =>
                    window.open(
                      deviceFlow.verificationUriComplete || deviceFlow.verificationUri,
                      '_blank',
                      'noopener,noreferrer',
                    )
                  }
                >
                  Open GitHub
                </Button>
                <Button variant="outline" onClick={cancelDeviceFlow}>
                  Cancel
                </Button>
              </div>

              {deviceFlow.status === 'pending' && (
                <p className="text-center text-xs text-bolt-elements-textTertiary">
                  Polling GitHub every {deviceFlow.interval}s...
                </p>
              )}
              {deviceFlow.status === 'error' && (
                <div className="text-center space-y-2">
                  <p className="text-sm text-red-500">{deviceFlow.error}</p>
                  <Button variant="outline" size="sm" onClick={() => void startDeviceFlow()}>
                    Try again
                  </Button>
                </div>
              )}
            </div>
          )}
        </div>
      ) : isStatsLoading && !stats ? (
        <div className="flex flex-col items-center justify-center p-8 space-y-4">
          <div className="animate-spin w-8 h-8 border-2 border-bolt-elements-borderColorActive border-t-transparent rounded-full" />
          <p className="text-sm text-bolt-elements-textSecondary">Loading repositories...</p>
        </div>
      ) : !repositories.length ? (
        <div className="text-center p-8">
          <GitBranch className="w-12 h-12 text-bolt-elements-textTertiary mx-auto mb-4" />
          <p className="text-bolt-elements-textSecondary mb-4">No repositories found</p>
          <Button variant="outline" onClick={handleRefresh} disabled={isRefreshing}>
            <RefreshCw className={classNames('w-4 h-4 mr-2', { 'animate-spin': isRefreshing })} />
            Refresh
          </Button>
        </div>
      ) : (
        <>
          {error && repositories.length > 0 && (
            <div className="p-3 rounded-lg bg-yellow-50 border border-yellow-200 dark:bg-yellow-900/20 dark:border-yellow-700">
              <p className="text-sm text-yellow-800 dark:text-yellow-200">Warning: {error}. Showing cached data.</p>
            </div>
          )}

          <div className="flex flex-col sm:flex-row gap-4">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-bolt-elements-textTertiary" />
              <input
                type="text"
                placeholder="Search repositories..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-10 pr-4 py-2 rounded-lg bg-bolt-elements-background-depth-1 border border-bolt-elements-borderColor text-bolt-elements-textPrimary placeholder-bolt-elements-textTertiary focus:outline-none focus:ring-1 focus:ring-bolt-elements-borderColorActive"
              />
            </div>

            <div className="flex items-center gap-2">
              <Calendar className="w-4 h-4 text-bolt-elements-textTertiary" />
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as SortOption)}
                className="px-3 py-2 rounded-lg bg-bolt-elements-background-depth-1 border border-bolt-elements-borderColor text-bolt-elements-textPrimary text-sm focus:outline-none focus:ring-1 focus:ring-bolt-elements-borderColorActive"
              >
                <option value="updated">Recently updated</option>
                <option value="stars">Most starred</option>
                <option value="name">Name (A-Z)</option>
                <option value="created">Recently created</option>
              </select>
            </div>

            <div className="flex items-center gap-2">
              <Filter className="w-4 h-4 text-bolt-elements-textTertiary" />
              <select
                value={filterBy}
                onChange={(e) => setFilterBy(e.target.value as FilterOption)}
                className="px-3 py-2 rounded-lg bg-bolt-elements-background-depth-1 border border-bolt-elements-borderColor text-bolt-elements-textPrimary text-sm focus:outline-none focus:ring-1 focus:ring-bolt-elements-borderColorActive"
              >
                <option value="all">All repositories</option>
                <option value="own">Own repositories</option>
                <option value="forks">Forked repositories</option>
                <option value="archived">Archived repositories</option>
              </select>
            </div>
          </div>

          {currentRepositories.length > 0 ? (
            <>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {currentRepositories.map((repo) => (
                  <GitHubRepositoryCard key={repo.id} repo={repo} onClone={() => handleCloneRepository(repo)} />
                ))}
              </div>

              {totalPages > 1 && (
                <div className="flex items-center justify-between pt-4 border-t border-bolt-elements-borderColor">
                  <div className="text-sm text-bolt-elements-textSecondary">
                    Showing {Math.min(startIndex + 1, filteredRepositories.length)} to{' '}
                    {Math.min(startIndex + REPOS_PER_PAGE, filteredRepositories.length)} of {filteredRepositories.length}{' '}
                    repositories
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      onClick={() => setCurrentPage((prev) => Math.max(1, prev - 1))}
                      disabled={currentPage === 1}
                      variant="outline"
                      size="sm"
                    >
                      Previous
                    </Button>
                    <span className="text-sm text-bolt-elements-textSecondary px-3">
                      {currentPage} of {totalPages}
                    </span>
                    <Button
                      onClick={() => setCurrentPage((prev) => Math.min(totalPages, prev + 1))}
                      disabled={currentPage === totalPages}
                      variant="outline"
                      size="sm"
                    >
                      Next
                    </Button>
                  </div>
                </div>
              )}
            </>
          ) : (
            <div className="text-center py-8">
              <p className="text-bolt-elements-textSecondary">No repositories found matching your search criteria.</p>
            </div>
          )}
        </>
      )}

      {selectedRepo && (
        <BranchSelector
          provider="github"
          repoOwner={selectedRepo.full_name.split('/')[0]}
          repoName={selectedRepo.full_name.split('/')[1]}
          token={connection?.token || ''}
          defaultBranch={selectedRepo.default_branch}
          onBranchSelect={handleBranchSelect}
          onClose={handleCloseBranchSelector}
          isOpen={isBranchSelectorOpen}
        />
      )}
    </motion.div>
  );
}
