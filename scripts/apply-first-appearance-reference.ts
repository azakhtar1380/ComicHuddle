// Applies the hand-checked first appearances (lib/first-appearance-reference.ts) to the database now.
// The character import also does this at the end of every run.
import {getDb} from '../db';
import {applyFirstAppearanceReference} from '../lib/characters-reference';
const report=await applyFirstAppearanceReference(getDb() as never);
console.log(`characters checked: ${report.characters}, rows applied: ${report.applied}`);
if(report.noIssue.length)console.log('No matching issue found for:\n  '+report.noIssue.join('\n  '));
if(report.noCharacter.length)console.log('No matching character found for:\n  '+report.noCharacter.join('\n  '));
process.exit(0);
