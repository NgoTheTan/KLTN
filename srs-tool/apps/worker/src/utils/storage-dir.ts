import * as fs from 'fs';
import * as path from 'path';

/**
 * Resolves the shared upload directory consistently across `@srs-tool/api` and `@srs-tool/worker`.
 * Priority:
 * 1. Explicit `UPLOAD_DIR` environment variable
 * 2. `<monorepo-root>/.uploads` (located via `pnpm-workspace.yaml`)
 * 3. `<process.cwd()>/.uploads` fallback
 */
export function resolveUploadDir(): string {
  if (process.env['UPLOAD_DIR']) {
    const dir = path.resolve(process.env['UPLOAD_DIR']);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    return dir;
  }

  let curr = typeof __dirname !== 'undefined' ? __dirname : process.cwd();
  for (let depth = 0; depth < 7; depth++) {
    if (fs.existsSync(path.join(curr, 'pnpm-workspace.yaml'))) {
      const dir = path.join(curr, '.uploads');
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      return dir;
    }
    const parent = path.dirname(curr);
    if (parent === curr) break;
    curr = parent;
  }

  const fallback = path.resolve(process.cwd(), '.uploads');
  if (!fs.existsSync(fallback)) fs.mkdirSync(fallback, { recursive: true });
  return fallback;
}
