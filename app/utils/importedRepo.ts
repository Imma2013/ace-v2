import ignore from 'ignore';

import type { FileMap } from '~/lib/stores/files';

export interface ImportedRepoFile {
  path: string;
  content: string;
}

const IMPORT_IGNORE_PATTERNS = [
  'node_modules/**',
  '.git/**',
  '.next/**',
  'dist/**',
  'build/**',
  'coverage/**',
  '.cache/**',
  '.idea/**',
  '.turbo/**',
  '.output/**',
  '.vercel/**',
  '**/*.log',
  '**/.DS_Store',
  '**/npm-debug.log*',
  '**/yarn-debug.log*',
  '**/yarn-error.log*',
];

const ALWAYS_INCLUDE_BASENAMES = new Set([
  '.gitignore',
  '.npmrc',
  '.nvmrc',
  '.env.example',
  '.env.local.example',
  '.env.development.example',
  '.env.production.example',
  'package.json',
  'package-lock.json',
  'pnpm-lock.yaml',
  'yarn.lock',
  'bun.lock',
  'bun.lockb',
  'tsconfig.json',
  'tsconfig.app.json',
  'tsconfig.node.json',
  'components.json',
]);

const ALWAYS_INCLUDE_PREFIXES = ['vite.config.', 'next.config.', 'astro.config.', 'svelte.config.', 'tailwind.config.'];

const MAX_FILE_SIZE = 1024 * 1024;
const MAX_TOTAL_SIZE = 5 * 1024 * 1024;
const MAX_IMPORT_FILE_COUNT = 400;

const textDecoder = new TextDecoder('utf-8', { fatal: true });
const textEncoder = new TextEncoder();
const ig = ignore().add(IMPORT_IGNORE_PATTERNS);

function basename(filePath: string) {
  const segments = filePath.split('/');
  return segments[segments.length - 1] || filePath;
}

function shouldAlwaysInclude(filePath: string) {
  const fileName = basename(filePath);
  return ALWAYS_INCLUDE_BASENAMES.has(fileName) || ALWAYS_INCLUDE_PREFIXES.some((prefix) => fileName.startsWith(prefix));
}

function decodeTextFile(content: string | Uint8Array, encoding?: string) {
  if (typeof content === 'string') {
    return content;
  }

  if (content instanceof Uint8Array) {
    if (encoding === 'utf8') {
      return textDecoder.decode(content);
    }

    try {
      return textDecoder.decode(content);
    } catch {
      return null;
    }
  }

  return null;
}

function describeSkipReason(filePath: string, reason: string) {
  return `${filePath} (${reason})`;
}

export function buildImportedRepoSnapshot(data: Record<string, { data: any; encoding?: string }>) {
  const filePaths = Object.keys(data).filter((filePath) => !ig.ignores(filePath));
  const prioritizedPaths = [
    ...filePaths.filter(shouldAlwaysInclude),
    ...filePaths.filter((filePath) => !shouldAlwaysInclude(filePath)),
  ];

  const seen = new Set<string>();
  const files: ImportedRepoFile[] = [];
  const skippedFiles: string[] = [];
  let totalSize = 0;

  for (const filePath of prioritizedPaths) {
    if (seen.has(filePath)) {
      continue;
    }

    seen.add(filePath);

    if (files.length >= MAX_IMPORT_FILE_COUNT) {
      skippedFiles.push(describeSkipReason(filePath, 'import file limit reached'));
      continue;
    }

    const entry = data[filePath];

    if (!entry) {
      continue;
    }

    const decodedContent = decodeTextFile(entry.data, entry.encoding);

    if (decodedContent === null) {
      skippedFiles.push(describeSkipReason(filePath, 'binary or unsupported encoding'));
      continue;
    }

    const fileSize = textEncoder.encode(decodedContent).length;
    const alwaysInclude = shouldAlwaysInclude(filePath);

    if (fileSize > MAX_FILE_SIZE && !alwaysInclude) {
      skippedFiles.push(describeSkipReason(filePath, `too large: ${Math.round(fileSize / 1024)}KB`));
      continue;
    }

    if (totalSize + fileSize > MAX_TOTAL_SIZE && !alwaysInclude) {
      skippedFiles.push(describeSkipReason(filePath, 'would exceed total size limit'));
      continue;
    }

    files.push({
      path: filePath,
      content: decodedContent,
    });
    totalSize += fileSize;
  }

  return {
    files,
    skippedFiles,
  };
}

export function buildImportedRepoFileMap(data: Record<string, { data: any; encoding?: string }>): FileMap {
  const fileMap: FileMap = {};
  const filePaths = Object.keys(data).filter((filePath) => !ig.ignores(filePath));

  for (const filePath of filePaths) {
    const entry = data[filePath];

    if (!entry) {
      continue;
    }

    const decodedContent = decodeTextFile(entry.data, entry.encoding);

    if (decodedContent === null) {
      continue;
    }

    const segments = filePath.split('/').filter(Boolean);
    let currentPath = '';

    for (let i = 0; i < segments.length - 1; i++) {
      currentPath += `/${segments[i]}`;

      if (!fileMap[currentPath]) {
        fileMap[currentPath] = {
          type: 'folder',
        };
      }
    }

    fileMap[`/${filePath}`] = {
      type: 'file',
      content: decodedContent,
      isBinary: false,
    };
  }

  return fileMap;
}
