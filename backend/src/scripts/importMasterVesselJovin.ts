#!/usr/bin/env ts-node
import path from 'path';
import { importMasterVesselJovinFromFile } from '../services/masterVesselJovinImport.service';

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const fileIdx = args.findIndex((a) => a === '--file');
  const filePath =
    fileIdx >= 0 && args[fileIdx + 1]
      ? path.resolve(args[fileIdx + 1])
      : path.resolve(__dirname, '../../../docs/Vessel Cleanup.xlsx');

  console.log(`Import Jovin master vessels (${dryRun ? 'DRY RUN' : 'APPLY'})`);
  console.log(`File: ${filePath}`);

  const stats = await importMasterVesselJovinFromFile(filePath, { dryRun });

  console.log(JSON.stringify(stats, null, 2));
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
