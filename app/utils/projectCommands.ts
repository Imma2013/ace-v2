import type { Message } from 'ai';
import { generateId } from './fileUtils';

export interface ProjectCommands {
  type: string;
  setupCommand?: string;
  startCommand?: string;
  followupMessage: string;
}

export interface ProjectCommandOverrides {
  appName?: string;
  installCommand?: string;
  startCommand?: string;
}

export interface ManagedImportExecution {
  appName?: string;
  installCommand?: string;
  startCommand?: string;
  initialRunCommand?: string;
}

interface CreateCommandsMessageOptions {
  mode?: 'default' | 'sequential-start';
}

interface FileContent {
  content: string;
  path: string;
}

type PackageManager = 'npm' | 'pnpm' | 'yarn' | 'bun';

// Helper function to make any command non-interactive
function makeNonInteractive(command: string): string {
  // Set environment variables for non-interactive mode
  const envVars = 'export CI=true DEBIAN_FRONTEND=noninteractive FORCE_COLOR=0';

  // Common interactive packages and their non-interactive flags
  const interactivePackages = [
    { pattern: /npx\s+([^@\s]+@?[^\s]*)\s+init/g, replacement: 'echo "y" | npx --yes $1 init --defaults --yes' },
    { pattern: /npx\s+create-([^\s]+)/g, replacement: 'npx --yes create-$1 --template default' },
    { pattern: /npx\s+([^@\s]+@?[^\s]*)\s+add/g, replacement: 'npx --yes $1 add --defaults --yes' },
    {
      pattern: /npm\s+install(?!\s+--)/g,
      replacement: 'npm install --yes --include=dev --no-audit --no-fund --silent',
    },
    { pattern: /yarn\s+add(?!\s+--)/g, replacement: 'yarn add --non-interactive' },
    { pattern: /pnpm\s+add(?!\s+--)/g, replacement: 'pnpm add --yes' },
  ];

  let processedCommand = command;

  // Apply replacements for known interactive patterns
  interactivePackages.forEach(({ pattern, replacement }) => {
    processedCommand = processedCommand.replace(pattern, replacement);
  });

  return `${envVars} && ${processedCommand}`;
}

function detectPackageManager(files: FileContent[], packageJson: any): PackageManager {
  const packageManager = packageJson?.packageManager;

  if (typeof packageManager === 'string') {
    if (packageManager.startsWith('pnpm')) {
      return 'pnpm';
    }

    if (packageManager.startsWith('yarn')) {
      return 'yarn';
    }

    if (packageManager.startsWith('bun')) {
      return 'bun';
    }
  }

  if (files.some((file) => file.path.endsWith('pnpm-lock.yaml'))) {
    return 'pnpm';
  }

  if (files.some((file) => file.path.endsWith('yarn.lock'))) {
    return 'yarn';
  }

  if (files.some((file) => file.path.endsWith('bun.lockb') || file.path.endsWith('bun.lock'))) {
    return 'bun';
  }

  return 'npm';
}

function getInstallCommand(packageManager: PackageManager) {
  switch (packageManager) {
    case 'pnpm':
      return 'npx update-browserslist-db@latest && corepack enable && pnpm install --prod=false --reporter=silent';
    case 'yarn':
      return 'npx update-browserslist-db@latest && corepack enable && yarn install --silent';
    case 'bun':
      return 'bun install';
    case 'npm':
    default:
      return 'npx update-browserslist-db@latest && npm install --include=dev --legacy-peer-deps';
  }
}

function getStartCommand(packageManager: PackageManager, scriptName: string) {
  switch (packageManager) {
    case 'pnpm':
      return `((pnpm install --prod=false --reporter=silent && pnpm run ${scriptName}) || (corepack enable && pnpm install --prod=false --reporter=silent && pnpm run ${scriptName}) || (npm install --include=dev --legacy-peer-deps && npm run ${scriptName}))`;
    case 'yarn':
      return `((yarn install --silent && yarn ${scriptName}) || (corepack enable && yarn install --silent && yarn ${scriptName}) || (npm install --include=dev --legacy-peer-deps && npm run ${scriptName}))`;
    case 'bun':
      return `((bun install && bun run ${scriptName}) || (npm install --include=dev --legacy-peer-deps && npm run ${scriptName}))`;
    case 'npm':
    default:
      return `((npm install --include=dev --legacy-peer-deps && npm run ${scriptName}) || (corepack enable && pnpm install --prod=false --reporter=silent && pnpm run ${scriptName}) || (yarn install --silent && yarn ${scriptName}))`;
  }
}

export async function detectProjectCommands(files: FileContent[]): Promise<ProjectCommands> {
  const hasFile = (name: string) => files.some((f) => f.path.endsWith(name));
  const hasFileContent = (name: string, content: string) =>
    files.some((f) => f.path.endsWith(name) && f.content.includes(content));

  if (hasFile('package.json')) {
    const packageJsonFile = files.find((f) => f.path.endsWith('package.json'));

    if (!packageJsonFile) {
      return { type: '', setupCommand: '', followupMessage: '' };
    }

    try {
      const packageJson = JSON.parse(packageJsonFile.content);
      const scripts = packageJson?.scripts || {};
      const dependencies = { ...packageJson.dependencies, ...packageJson.devDependencies };
      const packageManager = detectPackageManager(files, packageJson);

      // Check if this is a shadcn project
      const isShadcnProject =
        hasFileContent('components.json', 'shadcn') ||
        Object.keys(dependencies).some((dep) => dep.includes('shadcn')) ||
        hasFile('components.json');

      // Check for preferred commands in priority order
      const preferredCommands = ['dev', 'start', 'preview'];
      const availableCommand = preferredCommands.find((cmd) => scripts[cmd]);

      // Build setup command with non-interactive handling
      let baseSetupCommand = getInstallCommand(packageManager);

      // Add shadcn init if it's a shadcn project
      if (isShadcnProject) {
        baseSetupCommand += ' && npx shadcn@latest init';
      }

      const setupCommand = makeNonInteractive(baseSetupCommand);

      if (availableCommand) {
        return {
          type: 'Node.js',
          setupCommand,
          startCommand: getStartCommand(packageManager, availableCommand),
          followupMessage: `Found "${availableCommand}" script in package.json. Running it with ${packageManager} after installation.`,
        };
      }

      return {
        type: 'Node.js',
        setupCommand,
        followupMessage:
          'Would you like me to inspect package.json to determine the available scripts for running this project?',
      };
    } catch (error) {
      console.error('Error parsing package.json:', error);
      return { type: '', setupCommand: '', followupMessage: '' };
    }
  }

  if (hasFile('index.html')) {
    return {
      type: 'Static',
      startCommand: 'npx --yes serve',
      followupMessage: '',
    };
  }

  return { type: '', setupCommand: '', followupMessage: '' };
}

export function applyProjectCommandOverrides(
  commands: ProjectCommands,
  overrides: ProjectCommandOverrides = {},
): ManagedImportExecution {
  const installCommand = overrides.installCommand?.trim() || commands.setupCommand;
  const startCommand = overrides.startCommand?.trim() || commands.startCommand;
  const appName = overrides.appName?.trim() || undefined;

  let initialRunCommand = startCommand;

  if (installCommand && startCommand) {
    initialRunCommand = `${installCommand} && ${startCommand}`;
  } else if (installCommand) {
    initialRunCommand = installCommand;
  }

  return {
    appName,
    installCommand,
    startCommand,
    initialRunCommand,
  };
}

export function createCommandsMessage(
  commands: ProjectCommands,
  options: CreateCommandsMessageOptions = {},
): Message | null {
  if (!commands.setupCommand && !commands.startCommand) {
    return null;
  }

  const mode = options.mode ?? 'default';
  let commandString = '';

  if (mode === 'sequential-start' && commands.startCommand) {
    const combinedCommand = commands.setupCommand ? `${commands.setupCommand} && ${commands.startCommand}` : commands.startCommand;
    commandString += `
<boltAction type="start">${combinedCommand}</boltAction>
`;
  } else if (commands.setupCommand) {
    commandString += `
<boltAction type="shell">${commands.setupCommand}</boltAction>`;
    if (commands.startCommand) {
      commandString += `
<boltAction type="start">${commands.startCommand}</boltAction>
`;
    }
  }

  return {
    role: 'assistant',
    content: `
${commands.followupMessage ? `\n\n${commands.followupMessage}` : ''}
<boltArtifact id="project-setup" title="Project Setup">
${commandString}
</boltArtifact>`,
    id: generateId(),
    createdAt: new Date(),
  };
}

export function escapeBoltArtifactTags(input: string) {
  // Regular expression to match boltArtifact tags and their content
  const regex = /(<boltArtifact[^>]*>)([\s\S]*?)(<\/boltArtifact>)/g;

  return input.replace(regex, (match, openTag, content, closeTag) => {
    // Escape the opening tag
    const escapedOpenTag = openTag.replace(/</g, '&lt;').replace(/>/g, '&gt;');

    // Escape the closing tag
    const escapedCloseTag = closeTag.replace(/</g, '&lt;').replace(/>/g, '&gt;');

    // Return the escaped version
    return `${escapedOpenTag}${content}${escapedCloseTag}`;
  });
}

export function escapeBoltAActionTags(input: string) {
  // Regular expression to match boltArtifact tags and their content
  const regex = /(<boltAction[^>]*>)([\s\S]*?)(<\/boltAction>)/g;

  return input.replace(regex, (match, openTag, content, closeTag) => {
    // Escape the opening tag
    const escapedOpenTag = openTag.replace(/</g, '&lt;').replace(/>/g, '&gt;');

    // Escape the closing tag
    const escapedCloseTag = closeTag.replace(/</g, '&lt;').replace(/>/g, '&gt;');

    // Return the escaped version
    return `${escapedOpenTag}${content}${escapedCloseTag}`;
  });
}

export function escapeBoltTags(input: string) {
  return escapeBoltArtifactTags(escapeBoltAActionTags(input));
}

// We have this seperate function to simplify the restore snapshot process in to one single artifact.
export function createCommandActionsString(commands: ProjectCommands): string {
  if (!commands.setupCommand && !commands.startCommand) {
    // Return empty string if no commands
    return '';
  }

  let commandString = '';

  if (commands.setupCommand) {
    commandString += `
<boltAction type="shell">${commands.setupCommand}</boltAction>`;
  }

  if (commands.startCommand) {
    commandString += `
<boltAction type="start">${commands.startCommand}</boltAction>
`;
  }

  return commandString;
}
