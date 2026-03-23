import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { fileURLToPath } from 'url';

const execFileAsync = promisify(execFile);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PYTHON_HELPER = path.join(__dirname, 'x_browser_post.py');

function resolvePythonBin() {
  const candidates = [
    process.env.CONTENT_GEN_PYTHON,
    'python3',
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (candidate.startsWith('/') && !fs.existsSync(candidate)) {
      continue;
    }
    return candidate;
  }

  return 'python3';
}

function parseJsonFromOutput(stdout, stderr) {
  const combined = `${stdout || ''}\n${stderr || ''}`.trim();
  const lines = combined.split('\n').map(line => line.trim()).filter(Boolean).reverse();
  for (const line of lines) {
    try {
      return JSON.parse(line);
    } catch {
      continue;
    }
  }
  throw new Error(`No JSON result from x browser helper.\n${combined}`);
}

export async function postToXViaBrowser({ text, mediaPaths = [], headless = true }) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'content-gen-x-post-'));
  const argsPath = path.join(tmpDir, 'args.json');
  fs.writeFileSync(argsPath, JSON.stringify({
    text,
    media_paths: mediaPaths,
    headless,
  }));

  try {
    const { stdout, stderr } = await execFileAsync(resolvePythonBin(), [PYTHON_HELPER, argsPath], {
      cwd: path.join(__dirname, '..', '..'),
      maxBuffer: 1024 * 1024 * 4,
    });
    const result = parseJsonFromOutput(stdout, stderr);
    if (!result.ok) {
      throw new Error(result.error || 'Unknown X browser post error');
    }
    return {
      tweetId: result.id,
      tweetUrl: result.permalink,
      username: result.username,
      method: result.method,
    };
  } catch (error) {
    if (error.stdout || error.stderr) {
      try {
        const result = parseJsonFromOutput(error.stdout, error.stderr);
        throw new Error(result.error || 'Unknown X browser post error');
      } catch (parseError) {
        throw parseError;
      }
    }
    throw error;
  } finally {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
  }
}
