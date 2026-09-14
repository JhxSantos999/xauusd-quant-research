import { runPaperJournalDemoV1 } from '../../adapters/paper/paper-journal-demo-v1.js';

function parseOutputPathV1(argv: readonly string[]): string {
  if (argv.length !== 2 || argv[0] !== '--output' || !argv[1]) {
    throw new Error('USAGE: node run-paper-journal-demo-v1.js --output <path.jsonl>');
  }
  return argv[1];
}

async function main(): Promise<void> {
  const outputFilePath = parseOutputPathV1(process.argv.slice(2));
  const result = await runPaperJournalDemoV1(outputFilePath);
  console.log('PAPER_JOURNAL_DEMO_V1_PASS');
  console.log(`mode=${result.mode}`);
  console.log(`output=${result.outputFilePath}`);
  console.log(`records=${result.recordCount}`);
  console.log(`decisions=${result.decisions.join(',')}`);
  console.log(`sha256=${result.sha256}`);
  console.log(`future_lockbox_accessed=${result.futureLockboxAccessed}`);
  console.log(`pnl_evaluated=${result.pnlEvaluated}`);
  console.log(`live_execution=${result.liveExecution}`);
}

main().catch(error => {
  console.error('PAPER_JOURNAL_DEMO_V1_INVALID');
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
