import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

const [reportPath, fixturePath] = process.argv.slice(2);

if (!reportPath || !fixturePath) {
  console.error('usage: node scripts/assert-leak-report.mjs <safe-report> <fixture>');
  process.exit(2);
}

const reportText = await readFile(reportPath, 'utf8');
const report = JSON.parse(reportText);
const fixture = await readFile(fixturePath, 'utf8');
const secret = fixture.match(/mk_live_[A-Za-z0-9]{32}/)?.[0];

if (!secret) throw new Error('fixture did not contain the expected fake key');
if (!Array.isArray(report) || report.length !== 1) throw new Error('safe report did not contain one finding');
if (reportText.includes(secret) || reportText.includes('mk_live_')) throw new Error('safe report contains a raw key');

const expectedFingerprint = `sha256:${createHash('sha256').update(secret, 'utf8').digest('hex').slice(0, 12)}`;
if (report[0].fingerprint !== expectedFingerprint) throw new Error('safe report fingerprint did not match');
if (report[0].rule_id !== 'mistakeys-application-key') throw new Error('custom rule id was not reported');

console.log(JSON.stringify({
  fixture: 'detected',
  rule_id: report[0].rule_id,
  fingerprint: report[0].fingerprint,
}));
