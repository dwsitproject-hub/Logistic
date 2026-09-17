import logger from '../utils/logger';
import { runContractEtaReminderJob } from '../services/contractEtaReminder.service';

function readArgValue(flag: string): string | undefined {
  const withEquals = process.argv.find((arg) => arg.startsWith(`${flag}=`));
  if (withEquals) return withEquals.slice(flag.length + 1).trim() || undefined;
  const idx = process.argv.indexOf(flag);
  if (idx >= 0) return process.argv[idx + 1]?.trim() || undefined;
  return undefined;
}

async function main(): Promise<void> {
  const toRaw = readArgValue('--to');
  const recipientsOnly = process.argv.includes('--recipients-only');

  if (toRaw) {
    process.env.CONTRACT_ETA_REMINDER_EXTRA_RECIPIENTS = toRaw;
  }

  logger.info('Running Contract ETA reminder job manually...', {
    overrideRecipients: toRaw ?? null,
    recipientsOnly,
  });

  const result = await runContractEtaReminderJob({
    overrideRecipients: toRaw ? toRaw.split(/[,;]/).map((email) => email.trim()).filter(Boolean) : undefined,
    recipientsOnly: recipientsOnly && !!toRaw,
  });

  logger.info('Contract ETA reminder job finished', result);
  console.log(JSON.stringify(result, null, 2));

  if (!result.sent) {
    process.exitCode = 1;
  }
}

main()
  .then(() => process.exit(process.exitCode ?? 0))
  .catch((error) => {
    logger.error('Contract ETA reminder manual run failed', error);
    process.exit(1);
  });
