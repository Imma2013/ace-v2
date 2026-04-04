import { useSearchParams } from '@remix-run/react';
import { generateId, type Message } from 'ai';
import { useEffect, useState } from 'react';
import { ClientOnly } from 'remix-utils/client-only';
import { BaseChat } from '~/components/chat/BaseChat';
import { Chat } from '~/components/chat/Chat.client';
import { useGit } from '~/lib/hooks/useGit';
import { useChatHistory } from '~/lib/persistence';
import { applyProjectCommandOverrides, detectProjectCommands, escapeBoltTags } from '~/utils/projectCommands';
import { buildImportedRepoFileMap, buildImportedRepoSnapshot } from '~/utils/importedRepo';
import { LoadingOverlay } from '~/components/ui/LoadingOverlay';
import { toast } from 'react-toastify';
import { buildManagedAppId, getManagedAppName } from '~/utils/managedImport';

export function GitUrlImport() {
  const [searchParams] = useSearchParams();
  const { ready: historyReady, importChat } = useChatHistory();
  const { ready: gitReady, gitClone } = useGit();
  const [imported, setImported] = useState(false);
  const [loading, setLoading] = useState(true);

  const importRepo = async (repoUrl?: string) => {
    if (!gitReady && !historyReady) {
      return;
    }

    if (repoUrl) {
      try {
        const { workdir, data } = await gitClone(repoUrl);

        if (importChat) {
          const { files: fileContents, skippedFiles } = buildImportedRepoSnapshot(data);
          const fileMap = buildImportedRepoFileMap(data);

          const commands = await detectProjectCommands(fileContents);
          const execution = applyProjectCommandOverrides(commands, {
            appName: searchParams.get('appName') || getManagedAppName(repoUrl),
            installCommand: searchParams.get('installCommand') || undefined,
            startCommand: searchParams.get('startCommand') || undefined,
          });
          const managedImportCommand = execution.initialRunCommand;
          const appName = execution.appName || getManagedAppName(repoUrl);
          const appId = buildManagedAppId(repoUrl);

          const filesMessage: Message = {
            role: 'assistant',
            content: `Cloning the repo ${repoUrl} into ${workdir}
${skippedFiles.length > 0 ? `\nSkipped files (${skippedFiles.length}):\n${skippedFiles.map((f) => `- ${f}`).join('\n')}` : ''}
<boltArtifact id="imported-files" title="Git Cloned Files"  type="bundled">
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
          await importChat(
            `Git Project:${appName}`,
            messages,
            {
              gitUrl: repoUrl,
              managedImport: managedImportCommand
                ? {
                    appId,
                    appName,
                    source: 'git',
                    sourceUrl: repoUrl,
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
                  name: appName,
                  source: 'git',
                  sourceUrl: repoUrl,
                  runCommand: managedImportCommand,
                  installCommand: execution.installCommand,
                  startCommand: execution.startCommand,
                }
              : undefined,
          );
        }
      } catch (error) {
        console.error('Error during import:', error);
        toast.error('Failed to import repository');
        setLoading(false);
        window.location.href = '/';

        return;
      }
    }
  };

  useEffect(() => {
    if (!historyReady || !gitReady || imported) {
      return;
    }

    const url = searchParams.get('url');

    if (!url) {
      window.location.href = '/';
      return;
    }

    importRepo(url).catch((error) => {
      console.error('Error importing repo:', error);
      toast.error('Failed to import repository');
      setLoading(false);
      window.location.href = '/';
    });
    setImported(true);
  }, [searchParams, historyReady, gitReady, imported]);

  return (
    <ClientOnly fallback={<BaseChat />}>
      {() => (
        <>
          <Chat />
          {loading && <LoadingOverlay message="Please wait while we clone the repository..." />}
        </>
      )}
    </ClientOnly>
  );
}
