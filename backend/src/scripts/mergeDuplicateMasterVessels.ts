/**
 * Merge duplicate master_vessels rows that share the same normalized_vessel_name.
 * Also groups SAP codes as aliases. Prefer the Excel upload path on Master Vessel.
 *
 * Usage: npx ts-node src/scripts/mergeDuplicateMasterVessels.ts [--dry-run]
 */
import { runMasterVesselCleanup } from '../services/masterVesselCleanup.service';

async function main(): Promise<void> {
  const dryRun = process.argv.includes('--dry-run');
  const stats = await runMasterVesselCleanup({ dryRun });
  console.log(JSON.stringify(stats, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
