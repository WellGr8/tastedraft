/**
 * Copy the committed browser build into public/ so Next can fetch it.
 * Node's fs APIs keep this working in Windows cmd and POSIX shells.
 */
import { copyFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const source = join(here, '..', '..', '..', 'packages', 'engine-wasm', 'pkg', 'web', 'tastedraft_engine_bg.wasm');
const destDir = join(here, '..', 'public', 'engine');
mkdirSync(destDir, { recursive: true });
copyFileSync(source, join(destDir, 'tastedraft_engine_bg.wasm'));
