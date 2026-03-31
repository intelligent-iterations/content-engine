import fs from 'fs';
import path from 'path';

function resolvePlanPath(value) {
  return path.resolve(String(value || ''));
}

export function plansDirForRunArtifact(sourcePath) {
  return path.join(path.dirname(path.resolve(sourcePath)), 'plans');
}

export function toolPlanPathForManifest(manifestPath) {
  return path.join(plansDirForRunArtifact(manifestPath), 'tool-plan.json');
}

export function executionPlanPathForMd(mdPath) {
  return path.join(plansDirForRunArtifact(mdPath), 'execution-plan.json');
}

export function writeJsonArtifact(filePath, payload) {
  const resolvedPath = resolvePlanPath(filePath);
  fs.mkdirSync(path.dirname(resolvedPath), { recursive: true });
  fs.writeFileSync(resolvedPath, JSON.stringify(payload, null, 2));
  return resolvedPath;
}

export function readJsonArtifact(filePath) {
  const resolvedPath = resolvePlanPath(filePath);
  return JSON.parse(fs.readFileSync(resolvedPath, 'utf8'));
}
