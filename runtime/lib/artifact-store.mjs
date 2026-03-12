import fs from "node:fs/promises";
import path from "node:path";
import { ensureDir, nowIso, randomId, slugify } from './utils.mjs';

export class ArtifactStore {
  constructor(stateStore) {
    this.stateStore = stateStore;
  }

  async ensureRunDir(runId) {
    return ensureDir(this.stateStore.artifactDir(runId));
  }

  async nextScreenshotPath(runId, pathHint = 'screenshot.png') {
    const dir = await this.ensureRunDir(runId);
    return path.join(dir, slugify(pathHint.endsWith('.png') ? pathHint : `${pathHint}.png`));
  }

  async fromPath(runId, localPath, kind = 'other', name = null) {
    const stats = await fs.stat(localPath);
    return {
      artifact_id: randomId('art'),
      kind,
      path: localPath,
      name,
      mime_type: kind === 'screenshot' ? 'image/png' : 'application/octet-stream',
      size_bytes: stats.size,
      created_at: nowIso()
    };
  }
}
