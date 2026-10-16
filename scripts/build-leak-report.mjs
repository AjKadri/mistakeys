import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';

const [inputPath, outputPath, fallbackCommit = 'unknown'] = process.argv.slice(2);

if (!inputPath || !outputPath) {
  console.error('usage: node scripts/build-leak-report.mjs <gitleaks-json> <safe-report> [commit-sha]');
  process.exit(2);
}

const keyPattern = /mk_live_[A-Za-z0-9]{32}/g;
const rawReport = JSON.parse(await readFile(inputPath, 'utf8'));
const findings = Array.isArray(rawReport) ? rawReport : [];

async function keyFromFinding(finding, lineNumber) {
  if (typeof finding.Secret === 'string') {
    const secret = finding.Secret.match(keyPattern)?.[0];
    if (secret) return secret;
  }

  const filePath = finding.File ?? finding.FilePath;
  if (!filePath) return undefined;

  try {
    const lines = (await readFile(filePath, 'utf8')).split(/\r?\n/);
    return lines[lineNumber - 1]?.match(keyPattern)?.[0];
  } catch {
    return undefined;
  }
}

const safeFindings = [];

for (const finding of findings) {
  const line = Number(finding.StartLine ?? finding.LineNumber ?? 1);
  const filePath = finding.File ?? finding.FilePath;
  const secret = await keyFromFinding(finding, line);

  if (!secret) {
    throw new Error(`could not derive fingerprint for finding in ${filePath ?? 'unknown file'}`);
  }

  const fingerprint = `sha256:${createHash('sha256').update(secret, 'utf8').digest('hex').slice(0, 12)}`;
  safeFindings.push({
    file_path: filePath ?? 'unknown',
    line,
    commit_sha: finding.Commit || fallbackCommit,
    rule_id: finding.RuleID ?? finding.RuleId ?? 'unknown',
    fingerprint,
  });
}

await writeFile(outputPath, `${JSON.stringify(safeFindings, null, 2)}\n`, { mode: 0o600 });
