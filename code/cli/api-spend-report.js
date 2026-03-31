import { readApiSpendSummary } from '../shared/api-spend-tracker.js';

function formatUsd(value) {
  return `$${Number(value || 0).toFixed(4)}`;
}

function parseArgs(argv = process.argv.slice(2)) {
  return {
    asJson: argv.includes('--json'),
  };
}

function printBucket(title, bucket = {}, limit = 10) {
  const entries = Object.entries(bucket)
    .sort((a, b) => (b[1]?.usd || 0) - (a[1]?.usd || 0))
    .slice(0, limit);

  console.log(title);
  if (entries.length === 0) {
    console.log('  none');
    return;
  }

  for (const [key, value] of entries) {
    console.log(`  ${key}: ${formatUsd(value.usd)} across ${value.request_count} request(s)`);
  }
}

function main() {
  const args = parseArgs();
  const summary = readApiSpendSummary();

  if (args.asJson) {
    console.log(JSON.stringify(summary, null, 2));
    return;
  }

  const provider = summary.providers?.xai || {};
  const config = summary.config?.xai || {};
  const monthKey = new Date().toISOString().slice(0, 7);
  const dayKey = new Date().toISOString().slice(0, 10);

  console.log('API Spend Report');
  console.log(`Summary: ${summary.tracker_paths?.summary}`);
  console.log(`Events: ${summary.tracker_paths?.events}`);
  console.log('');
  console.log(`xAI lifetime: ${formatUsd(provider.lifetime_usd)}`);
  console.log(`xAI ${monthKey}: ${formatUsd(provider.by_month?.[monthKey]?.usd || 0)}`);
  console.log(`xAI ${dayKey}: ${formatUsd(provider.by_day?.[dayKey]?.usd || 0)}`);
  console.log(`Scope: ${config.scope || 'monthly'}`);
  console.log(`Budget: ${config.budgetUsd == null ? 'unset' : formatUsd(config.budgetUsd)}`);
  console.log(`Cap: ${config.capUsd == null ? 'unset' : formatUsd(config.capUsd)}`);
  console.log('');

  printBucket('By operation', provider.by_operation);
  console.log('');
  printBucket('By model', provider.by_model);
}

main();
