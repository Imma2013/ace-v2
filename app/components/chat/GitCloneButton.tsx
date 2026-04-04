import { useGit } from '~/lib/hooks/useGit';
import type { Message } from 'ai';
import { applyProjectCommandOverrides, detectProjectCommands, escapeBoltTags } from '~/utils/projectCommands';
import { generateId } from '~/utils/fileUtils';
import { buildImportedRepoFileMap, buildImportedRepoSnapshot } from '~/utils/importedRepo';
import { useState } from 'react';
import { toast } from 'react-toastify';
import { LoadingOverlay } from '~/components/ui/LoadingOverlay';

import { classNames } from '~/utils/classNames';
import { Button } from '~/components/ui/Button';
import { Input } from '~/components/ui/Input';
import type { IChatMetadata } from '~/lib/persistence/db';
import type { ManagedAppRecord } from '~/lib/persistence/db';
import type { Snapshot } from '~/lib/persistence/types';
import { X, Github, GitBranch } from 'lucide-react';
import { buildManagedAppId, getManagedAppName } from '~/utils/managedImport';

// Import the new repository selector components
import { GitHubRepositorySelector } from '~/components/@settings/tabs/github/components/GitHubRepositorySelector';
import { GitLabRepositorySelector } from '~/components/@settings/tabs/gitlab/components/GitLabRepositorySelector';

interface GitCloneButtonProps {
  className?: string;
  importChat?: (
    description: string,
    messages: Message[],
    metadata?: IChatMetadata,
    snapshot?: Snapshot,
    managedApp?: Omit<ManagedAppRecord, 'chatId' | 'urlId' | 'description' | 'updatedAt'>,
  ) => Promise<void>;
}

export default function GitCloneButton({ importChat, className }: GitCloneButtonProps) {
  const { ready, gitClone } = useGit();
  const [loading, setLoading] = useState(false);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [selectedProvider, setSelectedProvider] = useState<'github' | 'gitlab' | null>(null);
  const [customAppName, setCustomAppName] = useState('');
  const [customInstallCommand, setCustomInstallCommand] = useState('');
  const [customStartCommand, setCustomStartCommand] = useState('');

  const handleClone = async (repoUrl: string, branch?: string) => {
    if (!ready) {
      return;
    }

    const cloneTarget = branch && !repoUrl.includes('#') ? `${repoUrl}#${branch}` : repoUrl;

    setLoading(true);
    setIsDialogOpen(false);
    setSelectedProvider(null);

    try {
      const { workdir, data } = await gitClone(cloneTarget);

      if (importChat) {
        const { files: fileContents, skippedFiles } = buildImportedRepoSnapshot(data);
        const fileMap = buildImportedRepoFileMap(data);

        const commands = await detectProjectCommands(fileContents);
        const fallbackRepoLabel = getManagedAppName(cloneTarget);
        const execution = applyProjectCommandOverrides(commands, {
          appName: customAppName || fallbackRepoLabel,
          installCommand: customInstallCommand,
          startCommand: customStartCommand,
        });
        const repoLabel = execution.appName || fallbackRepoLabel;
        const appId = buildManagedAppId(cloneTarget, branch);

        const filesMessage: Message = {
          role: 'assistant',
          content: `Cloning the repo ${cloneTarget} into ${workdir}
${
  skippedFiles.length > 0
    ? `\nSkipped files (${skippedFiles.length}):
${skippedFiles.map((f) => `- ${f}`).join('\n')}`
    : ''
}

<boltArtifact id="imported-files" title="Git Cloned Files" type="bundled">
${fileContents
  .map(
    (file) =>
      `<boltAction type="file" filePath="${file.path}">
${escapeBoltTags(file.content)}
</boltAction>`,
  )
  .join('\n')}
</boltArtifact>`,
          id: generateId(),
          createdAt: new Date(),
        };

        const messages = [filesMessage];
        const managedImportCommand = execution.initialRunCommand;

        await importChat(
          `Git Project:${repoLabel}`,
          messages,
          {
          gitUrl: cloneTarget,
          gitBranch: branch,
          managedImport: managedImportCommand
            ? {
                appId,
                appName: repoLabel,
                source: 'git',
                sourceUrl: cloneTarget,
                runCommand: managedImportCommand,
                installCommand: execution.installCommand,
                startCommand: execution.startCommand,
                autoRun: true,
              }
            : undefined,
          },
          {
            chatIndex: filesMessage.id,
            files: fileMap,
          },
          managedImportCommand
            ? {
                id: appId,
                name: repoLabel,
                source: 'git',
                sourceUrl: cloneTarget,
                branch,
                runCommand: managedImportCommand,
                installCommand: execution.installCommand,
                startCommand: execution.startCommand,
              }
            : undefined,
        );
      }

      toast.success(branch ? `Imported repository branch "${branch}"` : 'Imported repository');
    } catch (error) {
      console.error('Error during import:', error);
      toast.error(error instanceof Error ? error.message : 'Failed to import repository');
    } finally {
      setLoading(false);
      setCustomAppName('');
      setCustomInstallCommand('');
      setCustomStartCommand('');
    }
  };

  return (
    <>
      <Button
        onClick={() => {
          setSelectedProvider(null);
          setIsDialogOpen(true);
        }}
        title="Clone a repo"
        variant="default"
        size="lg"
        className={classNames(
          'gap-2 bg-bolt-elements-background-depth-1',
          'text-bolt-elements-textPrimary',
          'hover:bg-bolt-elements-background-depth-2',
          'border border-bolt-elements-borderColor',
          'h-10 px-4 py-2 min-w-[120px] justify-center',
          'transition-all duration-200 ease-in-out',
          className,
        )}
        disabled={!ready || loading}
      >
        Clone a repo
        <div className="flex items-center gap-1 ml-2">
          <Github className="w-4 h-4" />
          <GitBranch className="w-4 h-4" />
        </div>
      </Button>

      {/* Provider Selection Dialog */}
      {isDialogOpen && !selectedProvider && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-gray-950 rounded-xl shadow-xl border border-bolt-elements-borderColor dark:border-bolt-elements-borderColor max-w-md w-full">
            <div className="p-6">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-semibold text-bolt-elements-textPrimary dark:text-bolt-elements-textPrimary">
                  Choose Repository Provider
                </h3>
                <button
                  onClick={() => setIsDialogOpen(false)}
                  className="p-2 rounded-lg bg-transparent hover:bg-bolt-elements-background-depth-1 dark:hover:bg-bolt-elements-background-depth-1 text-bolt-elements-textSecondary dark:text-bolt-elements-textSecondary hover:text-bolt-elements-textPrimary dark:hover:text-bolt-elements-textPrimary transition-all duration-200 hover:scale-105 active:scale-95"
                >
                  <X className="w-5 h-5 transition-transform duration-200 hover:rotate-90" />
                </button>
              </div>

              <div className="space-y-3">
                <button
                  onClick={() => setSelectedProvider('github')}
                  className="w-full p-4 rounded-lg bg-bolt-elements-background-depth-1 dark:bg-bolt-elements-background-depth-1 hover:bg-bolt-elements-background-depth-2 dark:hover:bg-bolt-elements-background-depth-2 border border-bolt-elements-borderColor dark:border-bolt-elements-borderColor hover:border-bolt-elements-borderColorActive dark:hover:border-bolt-elements-borderColorActive transition-all duration-200 text-left group"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-lg bg-blue-500/10 dark:bg-blue-500/20 flex items-center justify-center group-hover:bg-blue-500/20 dark:group-hover:bg-blue-500/30 transition-colors">
                      <Github className="w-6 h-6 text-blue-600 dark:text-blue-400" />
                    </div>
                    <div>
                      <div className="font-medium text-bolt-elements-textPrimary dark:text-bolt-elements-textPrimary">
                        GitHub
                      </div>
                      <div className="text-sm text-bolt-elements-textSecondary dark:text-bolt-elements-textSecondary">
                        Clone from GitHub repositories
                      </div>
                    </div>
                  </div>
                </button>

                <button
                  onClick={() => setSelectedProvider('gitlab')}
                  className="w-full p-4 rounded-lg bg-bolt-elements-background-depth-1 dark:bg-bolt-elements-background-depth-1 hover:bg-bolt-elements-background-depth-2 dark:hover:bg-bolt-elements-background-depth-2 border border-bolt-elements-borderColor dark:border-bolt-elements-borderColor hover:border-bolt-elements-borderColorActive dark:hover:border-bolt-elements-borderColorActive transition-all duration-200 text-left group"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-lg bg-orange-500/10 dark:bg-orange-500/20 flex items-center justify-center group-hover:bg-orange-500/20 dark:group-hover:bg-orange-500/30 transition-colors">
                      <GitBranch className="w-6 h-6 text-orange-600 dark:text-orange-400" />
                    </div>
                    <div>
                      <div className="font-medium text-bolt-elements-textPrimary dark:text-bolt-elements-textPrimary">
                        GitLab
                      </div>
                      <div className="text-sm text-bolt-elements-textSecondary dark:text-bolt-elements-textSecondary">
                        Clone from GitLab repositories
                      </div>
                    </div>
                  </div>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* GitHub Repository Selection */}
      {isDialogOpen && selectedProvider === 'github' && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-gray-950 rounded-xl shadow-xl border border-bolt-elements-borderColor dark:border-bolt-elements-borderColor w-full max-w-4xl max-h-[90vh] overflow-hidden">
            <div className="p-6 border-b border-bolt-elements-borderColor dark:border-bolt-elements-borderColor flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-blue-500/10 dark:bg-blue-500/20 flex items-center justify-center">
                  <Github className="w-6 h-6 text-blue-600 dark:text-blue-400" />
                </div>
                <div>
                  <h3 className="text-lg font-semibold text-bolt-elements-textPrimary dark:text-bolt-elements-textPrimary">
                    Import GitHub Repository
                  </h3>
                  <p className="text-sm text-bolt-elements-textSecondary dark:text-bolt-elements-textSecondary">
                    Clone a repository from GitHub to your workspace
                  </p>
                </div>
              </div>
              <button
                onClick={() => {
                  setIsDialogOpen(false);
                  setSelectedProvider(null);
                }}
                className="p-2 rounded-lg bg-transparent hover:bg-bolt-elements-background-depth-1 dark:hover:bg-bolt-elements-background-depth-1 text-bolt-elements-textSecondary dark:text-bolt-elements-textSecondary hover:text-bolt-elements-textPrimary dark:hover:text-bolt-elements-textPrimary transition-all duration-200 hover:scale-105 active:scale-95"
              >
                <X className="w-5 h-5 transition-transform duration-200 hover:rotate-90" />
              </button>
            </div>

            <div className="p-6 max-h-[calc(90vh-140px)] overflow-y-auto">
              <div className="mb-6 rounded-xl border border-bolt-elements-borderColor bg-bolt-elements-background-depth-1 p-4 space-y-4">
                <div>
                  <h4 className="text-sm font-semibold text-bolt-elements-textPrimary">Import Settings</h4>
                  <p className="text-sm text-bolt-elements-textSecondary">
                    Dyad-style import options. Leave commands blank to use detected defaults.
                  </p>
                </div>
                <Input
                  value={customAppName}
                  onChange={(e) => setCustomAppName(e.target.value)}
                  placeholder="Optional app name override"
                />
                <Input
                  value={customInstallCommand}
                  onChange={(e) => setCustomInstallCommand(e.target.value)}
                  placeholder="Optional install command override"
                />
                <Input
                  value={customStartCommand}
                  onChange={(e) => setCustomStartCommand(e.target.value)}
                  placeholder="Optional start command override"
                />
              </div>
              <GitHubRepositorySelector onClone={handleClone} />
            </div>
          </div>
        </div>
      )}

      {/* GitLab Repository Selection */}
      {isDialogOpen && selectedProvider === 'gitlab' && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-gray-950 rounded-xl shadow-xl border border-bolt-elements-borderColor dark:border-bolt-elements-borderColor w-full max-w-4xl max-h-[90vh] overflow-hidden">
            <div className="p-6 border-b border-bolt-elements-borderColor dark:border-bolt-elements-borderColor flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-orange-500/10 dark:bg-orange-500/20 flex items-center justify-center">
                  <GitBranch className="w-6 h-6 text-orange-600 dark:text-orange-400" />
                </div>
                <div>
                  <h3 className="text-lg font-semibold text-bolt-elements-textPrimary dark:text-bolt-elements-textPrimary">
                    Import GitLab Repository
                  </h3>
                  <p className="text-sm text-bolt-elements-textSecondary dark:text-bolt-elements-textSecondary">
                    Clone a repository from GitLab to your workspace
                  </p>
                </div>
              </div>
              <button
                onClick={() => {
                  setIsDialogOpen(false);
                  setSelectedProvider(null);
                }}
                className="p-2 rounded-lg bg-transparent hover:bg-bolt-elements-background-depth-1 dark:hover:bg-bolt-elements-background-depth-1 text-bolt-elements-textSecondary dark:text-bolt-elements-textSecondary hover:text-bolt-elements-textPrimary dark:hover:text-bolt-elements-textPrimary transition-all duration-200 hover:scale-105 active:scale-95"
              >
                <X className="w-5 h-5 transition-transform duration-200 hover:rotate-90" />
              </button>
            </div>

            <div className="p-6 max-h-[calc(90vh-140px)] overflow-y-auto">
              <div className="mb-6 rounded-xl border border-bolt-elements-borderColor bg-bolt-elements-background-depth-1 p-4 space-y-4">
                <div>
                  <h4 className="text-sm font-semibold text-bolt-elements-textPrimary">Import Settings</h4>
                  <p className="text-sm text-bolt-elements-textSecondary">
                    Leave commands blank to use detected defaults.
                  </p>
                </div>
                <Input
                  value={customAppName}
                  onChange={(e) => setCustomAppName(e.target.value)}
                  placeholder="Optional app name override"
                />
                <Input
                  value={customInstallCommand}
                  onChange={(e) => setCustomInstallCommand(e.target.value)}
                  placeholder="Optional install command override"
                />
                <Input
                  value={customStartCommand}
                  onChange={(e) => setCustomStartCommand(e.target.value)}
                  placeholder="Optional start command override"
                />
              </div>
              <GitLabRepositorySelector onClone={handleClone} />
            </div>
          </div>
        </div>
      )}

      {loading && <LoadingOverlay message="Please wait while we clone the repository..." />}
    </>
  );
}
