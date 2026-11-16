// Applies the hand-checked character merges (lib/character-merges.ts) to the database now.
// The character import also does this at the end of every run.
import {getDb} from '../db';
import {applyCharacterMerges,hideNonComicCharacters} from '../lib/character-merges';
const report=await applyCharacterMerges(getDb() as never);
console.log(`merged now: ${report.merged}, already merged: ${report.already}`);
if(report.skipped.length)console.log('Skipped (left as two pages):\n  '+report.skipped.join('\n  '));
console.log(`hidden non-comic records updated: ${await hideNonComicCharacters(getDb() as never)}`);
process.exit(0);
