/**
 * `contracts/` is imported by path, so Node looks for zod next to that source.
 * Point contracts/node_modules/zod at the server install. A junction works
 * without admin rights on Windows.
 */
import { existsSync, lstatSync, mkdirSync, rmSync, symlinkSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const serverRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const zod = join(serverRoot, 'node_modules', 'zod');
const destDir = join(serverRoot, '..', 'contracts', 'node_modules');
const dest = join(destDir, 'zod');

if (!existsSync(zod)) {
  process.exit(0);
}

mkdirSync(destDir, { recursive: true });
if (existsSync(dest)) {
  const current = lstatSync(dest);
  if (!current.isSymbolicLink()) process.exit(0);
  rmSync(dest);
}

symlinkSync(zod, dest, process.platform === 'win32' ? 'junction' : 'dir');
