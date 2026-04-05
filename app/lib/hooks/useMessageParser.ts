import type { Message } from 'ai';
import { useCallback, useState } from 'react';
import { EnhancedStreamingMessageParser } from '~/lib/runtime/enhanced-message-parser';
import { workbenchStore } from '~/lib/stores/workbench';
import { createScopedLogger } from '~/utils/logger';
import type { ActionCallbackData } from '~/lib/runtime/message-parser';

const logger = createScopedLogger('useMessageParser');

/*
 * Track per-artifact state to detect when the AI writes a package.json
 * but forgets to emit install + start actions.
 */
let _currentArtifactId: string | undefined;
let _hasPackageJsonFile = false;
let _hasInstallAction = false;
let _hasStartAction = false;
let _lastMessageId: string | undefined;
let _nextActionId = 1000; // high offset to avoid collisions with parser-generated IDs
let _packageJsonContent: string | undefined;

function _resetArtifactTracking() {
  _hasPackageJsonFile = false;
  _hasInstallAction = false;
  _hasStartAction = false;
  _packageJsonContent = undefined;
}

/**
 * Detect the best dev script from a package.json content string.
 * Returns the install + start command, or null if nothing suitable found.
 */
function _detectAutoStartCommands(packageJsonContent: string): { installCmd: string; startCmd: string } | null {
  try {
    const pkg = JSON.parse(packageJsonContent);
    const scripts = pkg?.scripts || {};
    const preferredScripts = ['dev', 'start', 'preview'];
    const scriptName = preferredScripts.find((s) => scripts[s]);

    if (!scriptName) {
      return null;
    }

    return {
      installCmd: 'npm install --include=dev --legacy-peer-deps',
      startCmd: `npm run ${scriptName}`,
    };
  } catch {
    return null;
  }
}

const messageParser = new EnhancedStreamingMessageParser({
  callbacks: {
    onArtifactOpen: (data) => {
      logger.trace('onArtifactOpen', data);

      _currentArtifactId = data.id;
      _lastMessageId = data.messageId;
      _resetArtifactTracking();

      workbenchStore.showWorkbench.set(true);
      workbenchStore.addArtifact(data);
    },
    onArtifactClose: (data) => {
      logger.trace('onArtifactClose');

      workbenchStore.updateArtifact(data, { closed: true });

      /*
       * Auto-start fallback: if the AI wrote a package.json but never emitted
       * a start action, automatically inject install + start commands.
       * This mirrors how Dyad handles it at the infrastructure level.
       */
      if (_hasPackageJsonFile && !_hasStartAction && _packageJsonContent && data.artifactId) {
        const cmds = _detectAutoStartCommands(_packageJsonContent);

        if (cmds) {
          logger.debug('Auto-start fallback: AI did not emit start action, injecting install + start');

          if (!_hasInstallAction) {
            const installActionId = String(_nextActionId++);
            const installData: ActionCallbackData = {
              artifactId: data.artifactId,
              messageId: data.messageId,
              actionId: installActionId,
              action: { type: 'shell', content: cmds.installCmd },
            };
            workbenchStore.addAction(installData);
            workbenchStore.runAction(installData);
          }

          const startActionId = String(_nextActionId++);
          const startData: ActionCallbackData = {
            artifactId: data.artifactId,
            messageId: data.messageId,
            actionId: startActionId,
            action: { type: 'start', content: cmds.startCmd },
          };
          workbenchStore.addAction(startData);
          workbenchStore.runAction(startData);
        }
      }

      _resetArtifactTracking();
      _currentArtifactId = undefined;
    },
    onActionOpen: (data) => {
      logger.trace('onActionOpen', data.action);

      /*
       * File actions are streamed, so we add them immediately to show progress
       * Shell actions are complete when created by enhanced parser, so we wait for close
       */
      if (data.action.type === 'file') {
        workbenchStore.addAction(data);
      }
    },
    onActionClose: (data) => {
      logger.trace('onActionClose', data.action);

      // Track whether the AI emitted install/start actions
      if (data.action.type === 'shell') {
        const content = data.action.content.trim().toLowerCase();

        if (content.includes('npm install') || content.includes('pnpm install') || content.includes('yarn install') || content.includes('bun install')) {
          _hasInstallAction = true;
        }
      }

      if (data.action.type === 'start') {
        _hasStartAction = true;
      }

      // Track package.json file writes
      if (data.action.type === 'file' && 'filePath' in data.action) {
        const filePath = (data.action as any).filePath as string;

        if (filePath && filePath.endsWith('package.json')) {
          _hasPackageJsonFile = true;
          _packageJsonContent = data.action.content;
        }
      }

      /*
       * Add non-file actions (shell, build, start, etc.) when they close
       * Enhanced parser creates complete shell actions, so they're ready to execute
       */
      if (data.action.type !== 'file') {
        workbenchStore.addAction(data);
      }

      workbenchStore.runAction(data);
    },
    onActionStream: (data) => {
      logger.trace('onActionStream', data.action);
      workbenchStore.runAction(data, true);
    },
  },
});
const extractTextContent = (message: Message) =>
  Array.isArray(message.content)
    ? (message.content.find((item) => item.type === 'text')?.text as string) || ''
    : message.content;

export function useMessageParser() {
  const [parsedMessages, setParsedMessages] = useState<{ [key: number]: string }>({});

  const parseMessages = useCallback((messages: Message[], isLoading: boolean) => {
    let reset = false;

    if (import.meta.env.DEV && !isLoading) {
      reset = true;
      messageParser.reset();
    }

    for (const [index, message] of messages.entries()) {
      if (message.role === 'assistant' || message.role === 'user') {
        const newParsedContent = messageParser.parse(message.id, extractTextContent(message));
        setParsedMessages((prevParsed) => ({
          ...prevParsed,
          [index]: !reset ? (prevParsed[index] || '') + newParsedContent : newParsedContent,
        }));
      }
    }
  }, []);

  return { parsedMessages, parseMessages };
}
