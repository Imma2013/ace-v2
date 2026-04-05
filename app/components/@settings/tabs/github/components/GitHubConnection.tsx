import React from 'react';
import { motion } from 'framer-motion';
import { Button } from '~/components/ui/Button';
import { classNames } from '~/utils/classNames';
import { useGitHubConnection } from '~/lib/hooks';

interface ConnectionTestResult {
  status: 'success' | 'error' | 'testing';
  message: string;
  timestamp?: number;
}

interface GitHubConnectionProps {
  connectionTest: ConnectionTestResult | null;
  onTestConnection: () => void;
}

export function GitHubConnection({ connectionTest, onTestConnection }: GitHubConnectionProps) {
  const {
    connection,
    deviceFlow,
    isConnected,
    isLoading,
    isConnecting,
    connect,
    startDeviceFlow,
    cancelDeviceFlow,
    disconnect,
    error,
  } = useGitHubConnection();

  const [copied, setCopied] = React.useState(false);
  const [token, setToken] = React.useState('');
  const [tokenType, setTokenType] = React.useState<'classic' | 'fine-grained'>('classic');

  const handleConnect = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!token.trim()) {
      return;
    }

    try {
      await connect(token, tokenType);
      setToken('');
    } catch {
      // Hook handles the error state.
    }
  };

  const handleCopyCode = async () => {
    if (!deviceFlow?.userCode) {
      return;
    }

    try {
      await navigator.clipboard.writeText(deviceFlow.userCode);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch (copyError) {
      console.error('Failed to copy GitHub device code:', copyError);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-8">
        <div className="flex items-center gap-2">
          <div className="i-ph:spinner-gap-bold animate-spin w-4 h-4" />
          <span className="text-bolt-elements-textSecondary">Loading connection...</span>
        </div>
      </div>
    );
  }

  return (
    <motion.div
      className="bg-bolt-elements-background dark:bg-bolt-elements-background border border-bolt-elements-borderColor dark:border-bolt-elements-borderColor rounded-lg"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.2 }}
    >
      <div className="p-6 space-y-6">
        {!isConnected && (
          <>
            <div className="rounded-lg border border-bolt-elements-borderColor bg-bolt-elements-background-depth-1 p-4 space-y-4">
              <div className="flex items-start justify-between gap-4">
                <div className="space-y-1">
                  <p className="text-sm font-medium text-bolt-elements-textPrimary">Connect with GitHub device code</p>
                  <p className="text-xs text-bolt-elements-textSecondary">
                    Recommended. We'll give you a short code, you approve it on GitHub, and the app connects your
                    account without pasting a token.
                  </p>
                </div>
                <span className="rounded-full bg-bolt-elements-background px-2 py-1 text-[11px] font-medium text-bolt-elements-textSecondary">
                  Recommended
                </span>
              </div>

              {!deviceFlow && (
                <div className="flex flex-wrap items-center gap-3">
                  <button
                    type="button"
                    onClick={() => void startDeviceFlow()}
                    disabled={isConnecting}
                    className={classNames(
                      'px-4 py-2 rounded-lg text-sm flex items-center gap-2',
                      'bg-[#303030] text-white',
                      'hover:bg-[#5E41D0] hover:text-white',
                      'disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200',
                    )}
                  >
                    {isConnecting ? (
                      <>
                        <div className="i-ph:spinner-gap animate-spin" />
                        Starting...
                      </>
                    ) : (
                      <>
                        <div className="i-ph:device-mobile-camera w-4 h-4" />
                        Connect with GitHub
                      </>
                    )}
                  </button>
                  <span className="text-xs text-bolt-elements-textSecondary">
                    Requires `GITHUB_CLIENT_ID` or `VITE_GITHUB_CLIENT_ID`.
                  </span>
                </div>
              )}

              {deviceFlow && (
                <div className="space-y-4">
                  <div className="grid gap-3 md:grid-cols-[1fr_auto] md:items-center">
                    <div>
                      <p className="text-xs uppercase tracking-[0.2em] text-bolt-elements-textSecondary">
                        Your GitHub code
                      </p>
                      <div className="mt-2 rounded-lg border border-bolt-elements-borderColor bg-bolt-elements-background px-4 py-3 font-mono text-xl tracking-[0.3em] text-bolt-elements-textPrimary">
                        {deviceFlow.userCode}
                      </div>
                    </div>
                    <Button type="button" variant="outline" onClick={handleCopyCode}>
                      {copied ? 'Copied' : 'Copy code'}
                    </Button>
                  </div>

                  <div className="rounded-lg border border-bolt-elements-borderColor bg-bolt-elements-background p-4 text-sm text-bolt-elements-textSecondary space-y-2">
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

                  <div className="flex flex-wrap items-center gap-3">
                    <Button
                      type="button"
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
                    <Button type="button" variant="outline" onClick={cancelDeviceFlow}>
                      Cancel
                    </Button>
                    {deviceFlow.status === 'error' && (
                      <Button type="button" variant="outline" onClick={() => void startDeviceFlow()}>
                        Start again
                      </Button>
                    )}
                    {deviceFlow.status === 'pending' && (
                      <span className="text-xs text-bolt-elements-textSecondary">
                        Polling GitHub every {deviceFlow.interval}s
                      </span>
                    )}
                  </div>
                </div>
              )}
            </div>

            <div className="text-xs text-bolt-elements-textSecondary bg-bolt-elements-background-depth-1 dark:bg-bolt-elements-background-depth-1 p-3 rounded-lg">
              <p className="flex items-center gap-1 mb-1">
                <span className="i-ph:lightbulb w-3.5 h-3.5 text-bolt-elements-icon-success dark:text-bolt-elements-icon-success" />
                <span className="font-medium">Manual token fallback:</span> You can still connect with a PAT if you
                prefer.
              </p>
              <p>
                You can also set{' '}
                <code className="px-1 py-0.5 bg-bolt-elements-background-depth-2 dark:bg-bolt-elements-background-depth-2 rounded">
                  VITE_GITHUB_ACCESS_TOKEN
                </code>{' '}
                to auto-connect on startup.
              </p>
            </div>
          </>
        )}

        <form onSubmit={handleConnect} className="space-y-4">
          {!isConnected && (
            <details className="rounded-lg border border-bolt-elements-borderColor bg-bolt-elements-background-depth-1">
              <summary className="cursor-pointer list-none px-4 py-3 text-sm font-medium text-bolt-elements-textPrimary">
                Use a personal access token instead
              </summary>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 px-4 pb-4">
                <div>
                  <label className="block text-sm text-bolt-elements-textSecondary dark:text-bolt-elements-textSecondary mb-2">
                    Token Type
                  </label>
                  <select
                    value={tokenType}
                    onChange={(e) => setTokenType(e.target.value as 'classic' | 'fine-grained')}
                    disabled={isConnecting || isConnected}
                    className={classNames(
                      'w-full px-3 py-2 rounded-lg text-sm',
                      'bg-bolt-elements-background dark:bg-bolt-elements-background',
                      'border border-bolt-elements-borderColor dark:border-bolt-elements-borderColor',
                      'text-bolt-elements-textPrimary dark:text-bolt-elements-textPrimary',
                      'focus:outline-none focus:ring-1 focus:ring-bolt-elements-item-contentAccent dark:focus:ring-bolt-elements-item-contentAccent',
                      'disabled:opacity-50',
                    )}
                  >
                    <option value="classic">Personal Access Token (Classic)</option>
                    <option value="fine-grained">Fine-grained Token</option>
                  </select>
                </div>

                <div>
                  <label className="block text-sm text-bolt-elements-textSecondary dark:text-bolt-elements-textSecondary mb-2">
                    {tokenType === 'classic' ? 'Personal Access Token' : 'Fine-grained Token'}
                  </label>
                  <input
                    type="password"
                    value={token}
                    onChange={(e) => setToken(e.target.value)}
                    disabled={isConnecting || isConnected}
                    placeholder={`Enter your GitHub ${
                      tokenType === 'classic' ? 'personal access token' : 'fine-grained token'
                    }`}
                    className={classNames(
                      'w-full px-3 py-2 rounded-lg text-sm',
                      'bg-[#F8F8F8] dark:bg-[#1A1A1A]',
                      'border border-[#E5E5E5] dark:border-[#333333]',
                      'text-bolt-elements-textPrimary placeholder-bolt-elements-textTertiary',
                      'focus:outline-none focus:ring-1 focus:ring-bolt-elements-borderColorActive',
                      'disabled:opacity-50',
                    )}
                  />
                  <div className="mt-2 text-sm text-bolt-elements-textSecondary">
                    <a
                      href={`https://github.com/settings/tokens${tokenType === 'fine-grained' ? '/beta' : '/new'}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-bolt-elements-borderColorActive hover:underline inline-flex items-center gap-1"
                    >
                      Get your token
                      <div className="i-ph:arrow-square-out w-4 h-4" />
                    </a>
                    <span className="mx-2">|</span>
                    <span>
                      Required scopes:{' '}
                      {tokenType === 'classic' ? 'repo, read:org, read:user' : 'Repository access, Organization access'}
                    </span>
                  </div>
                </div>

                <div className="md:col-span-2">
                  <button
                    type="submit"
                    disabled={isConnecting || !token.trim()}
                    className={classNames(
                      'px-4 py-2 rounded-lg text-sm flex items-center gap-2',
                      'bg-[#303030] text-white',
                      'hover:bg-[#5E41D0] hover:text-white',
                      'disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200',
                      'transform active:scale-95',
                    )}
                  >
                    {isConnecting ? (
                      <>
                        <div className="i-ph:spinner-gap animate-spin" />
                        Connecting...
                      </>
                    ) : (
                      <>
                        <div className="i-ph:key w-4 h-4" />
                        Connect with token
                      </>
                    )}
                  </button>
                </div>
              </div>
            </details>
          )}

          {error && (
            <div className="p-4 rounded-lg bg-red-50 border border-red-200 dark:bg-red-900/20 dark:border-red-700">
              <p className="text-sm text-red-800 dark:text-red-200">{error}</p>
            </div>
          )}

          {isConnected && (
            <div className="flex items-center justify-between">
              <div className="flex items-center justify-between w-full">
                <div className="flex items-center gap-4">
                  <button
                    onClick={disconnect}
                    type="button"
                    className={classNames(
                      'px-4 py-2 rounded-lg text-sm flex items-center gap-2',
                      'bg-red-500 text-white',
                      'hover:bg-red-600',
                    )}
                  >
                    <div className="i-ph:plug w-4 h-4" />
                    Disconnect
                  </button>
                  <span className="text-sm text-bolt-elements-textSecondary flex items-center gap-1">
                    <div className="i-ph:check-circle w-4 h-4 text-green-500" />
                    {connection?.authMethod === 'device' ? 'Connected via device code' : 'Connected to GitHub'}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    onClick={() => window.open('https://github.com/dashboard', '_blank', 'noopener,noreferrer')}
                    className="flex items-center gap-2 hover:bg-bolt-elements-item-backgroundActive/10 hover:text-bolt-elements-textPrimary dark:hover:text-bolt-elements-textPrimary transition-colors"
                  >
                    <div className="i-ph:layout w-4 h-4" />
                    Dashboard
                  </Button>
                  <Button
                    onClick={onTestConnection}
                    disabled={connectionTest?.status === 'testing'}
                    variant="outline"
                    className="flex items-center gap-2 hover:bg-bolt-elements-item-backgroundActive/10 hover:text-bolt-elements-textPrimary dark:hover:text-bolt-elements-textPrimary transition-colors"
                  >
                    {connectionTest?.status === 'testing' ? (
                      <>
                        <div className="i-ph:spinner-gap w-4 h-4 animate-spin" />
                        Testing...
                      </>
                    ) : (
                      <>
                        <div className="i-ph:plug-charging w-4 h-4" />
                        Test Connection
                      </>
                    )}
                  </Button>
                </div>
              </div>
            </div>
          )}
        </form>
      </div>
    </motion.div>
  );
}
