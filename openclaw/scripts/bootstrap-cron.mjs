import { execFile as execFileCallback } from 'node:child_process';
import { promisify } from 'node:util';

const execFile = promisify(execFileCallback);

const dryRun = process.argv.includes('--dry-run');

const jobs = [
  {
    name: 'YiCompanion Medication Sweep',
    cron: '*/5 * * * *',
    message: 'Run the YiCompanion medication sweep for the current elder. Use emobit_get_medication_context, remind the elder first, notify guardians when needed, and place a guardian call only if the escalation policy requires it.',
  },
  {
    name: 'YiCompanion Daily Guardian Report',
    cron: '30 20 * * *',
    message: 'Generate and send the YiCompanion daily caregiver report for the current elder. Use emobit_get_daily_report_context and send exactly one concise guardian update.',
  },
  {
    name: 'YiCompanion Sundowning Sweep',
    cron: '*/10 15-20 * * *',
    message: 'Run the YiCompanion sundowning proactive support sweep. Use emobit_get_sundowning_context, reassure the elder, notify guardians when the risk is high, and place a guardian call only when escalation policy requires it.',
  },
];

async function main() {
  for (const job of jobs) {
    const args = [
      'cron',
      'add',
      '--name',
      job.name,
      '--cron',
      job.cron,
      '--session',
      'isolated',
      '--light-context',
      '--message',
      job.message,
    ];

    if (dryRun) {
      console.log(`openclaw ${args.join(' ')}`);
      continue;
    }

    try {
      const { stdout, stderr } = await execFile('openclaw', args, {
        timeout: 30000,
        env: process.env,
      });
      console.log(`[cron] ${job.name}`);
      if (stdout.trim()) console.log(stdout.trim());
      if (stderr.trim()) console.log(stderr.trim());
    } catch (error) {
      console.error(`[cron] Failed to install "${job.name}":`, error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    }
  }
}

main();
