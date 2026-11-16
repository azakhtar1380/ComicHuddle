// Hand-checked character merges: a Wikidata-only character record (id = -Q number) that is the same character as a
// Metron record, shown as one page. Every pair below was checked by hand (November 16, 2026); look-alike names that are
// different characters (alternate versions such as the "Days of Future Past" X-Men, legacy names such as Robin) are
// deliberately NOT listed. keepFact:false = merge the pages but do not carry over Wikidata's first-appearance issue,
// because it is wrong or doubtful for that character. Applied at the end of every character import; safe to rerun.
import {sql} from 'drizzle-orm';
import type {CatalogDb} from './catalog-store';
import {wikidataCharacterId} from './characters';

export type CharacterMerge={qid:string;name:string;metronId:number;into:string;keepFact?:false};
export const CHARACTER_MERGES:readonly CharacterMerge[]=[
 {qid:"Q1049890",name:"Sandman",metronId:134,into:"Sandman (Marvel)"},
 {qid:"Q1051111",name:"Destiny",metronId:4003,into:"Destiny (Mutant)"},
 {qid:"Q111325417",name:"Lucifer",metronId:1679,into:"Lucifer (Quists)"},
 {qid:"Q115424755",name:"Giganto",metronId:20368,into:"Giganto (Mole Man)"},
 {qid:"Q1410619",name:"Guardian",metronId:1621,into:"Guardian (Marvel)"},
 {qid:"Q2420331",name:"Gladiator",metronId:169,into:"Gladiator (Marvel)"},
 {qid:"Q281174",name:"Dominus",metronId:4369,into:"Dominus (Marvel)"},
 {qid:"Q3476419",name:"Scrambler",metronId:4647,into:"Scrambler (Marvel)"},
 {qid:"Q4006172",name:"Miracle Man",metronId:365,into:"Miracle Man (Marvel)"},
 {qid:"Q5142064",name:"Neutron",metronId:172,into:"Neutron (Marvel)"},
 {qid:"Q514912",name:"Captain Atom",metronId:6123,into:"Captain Atom (Allen Adam)"},
 {qid:"Q534153",name:"Captain Marvel",metronId:516,into:"Captain Marvel (DC)"},
 {qid:"Q546340",name:"Thunderbird",metronId:4377,into:"Thunderbird (John Proudstar)"},
 {qid:"Q628608",name:"Uncle Sam",metronId:870,into:"Uncle Sam (DC)"},
 {qid:"Q6751958",name:"Manta",metronId:173,into:"Manta (Marvel)"},
 {qid:"Q7200557",name:"Plague",metronId:4644,into:"Plague (Marvel)"},
 {qid:"Q735193",name:"Miss America",metronId:2805,into:"Miss America (Dale)"},
 {qid:"Q887309",name:"Nimrod",metronId:4683,into:"Nimrod (Marvel)"},
 {qid:"Q102268961",name:"Richard Parker",metronId:19431,into:"Richard Parker"},
 {qid:"Q102268990",name:"Mary Parker",metronId:19430,into:"Mary Parker"},
 {qid:"Q111309523",name:"Kierrok",metronId:30204,into:"Kierrok"},
 {qid:"Q111309788",name:"Michael Rossi",metronId:3985,into:"Michael Rossi"},
 {qid:"Q111310248",name:"Betsy Wilford",metronId:13177,into:"Betsy Wilford"},
 {qid:"Q111312547",name:"Lieutenant General Fredricks",metronId:29879,into:"Lieutenant General Fredricks"},
 {qid:"Q111312589",name:"Colonel Hendershoot",metronId:29878,into:"Colonel Hendershoot"},
 {qid:"Q111320129",name:"Bernard the Poet",metronId:30964,into:"Bernard the Poet"},
 {qid:"Q111327645",name:"Maa-Gor",metronId:7173,into:"Maa-Gor"},
 {qid:"Q111327778",name:"Kurt Marko",metronId:5364,into:"Kurt Marko"},
 {qid:"Q111333205",name:"Warren Worthington, Jr.",metronId:31001,into:"Warren Worthington Jr."},
 {qid:"Q111333212",name:"Kathryn Worthington",metronId:27331,into:"Kathryn Worthington"},
 {qid:"Q111333247",name:"Norton McCoy",metronId:22756,into:"Norton McCoy"},
 {qid:"Q111333248",name:"Edna McCoy",metronId:22754,into:"Edna McCoy"},
 {qid:"Q111338143",name:"Vera Cantor",metronId:2214,into:"Vera Cantor"},
 {qid:"Q111338148",name:"Ronald Rankin",metronId:20673,into:"Ronald Rankin"},
 {qid:"Q111347244",name:"Ted Roberts",metronId:11281,into:"Ted Roberts"},
 {qid:"Q111362638",name:"Mutant Master",metronId:30217,into:"Mutant-Master"},
 {qid:"Q111375856",name:"King Krono",metronId:29598,into:"King Krono"},
 {qid:"Q111410665",name:"Tanya Anderssen",metronId:3888,into:"Tanya Anderssen"},
 {qid:"Q111416967",name:"Amphibius",metronId:4689,into:"Amphibius"},
 {qid:"Q111416978",name:"Barbarus",metronId:4690,into:"Barbarus"},
 {qid:"Q111417013",name:"Equilibrius",metronId:12534,into:"Equilibrius"},
 {qid:"Q111443835",name:"General Chasen",metronId:30158,into:"General Chasen"},
 {qid:"Q111443859",name:"Nikolai Rasputin",metronId:38367,into:"Nikolai Rasputin"},
 {qid:"Q111443863",name:"Alexandra Rasputina",metronId:30214,into:"Alexandra Rasputina"},
 {qid:"Q111449140",name:"David Munroe",metronId:16986,into:"David Munroe"},
 {qid:"Q111449319",name:"Achmed el-Gibar",metronId:30208,into:"Achmed El-Gibar"},
 {qid:"Q111578075",name:"Nereel",metronId:17013,into:"Nereel"},
 {qid:"Q111578086",name:"Fahe",metronId:30213,into:"Fahe"},
 {qid:"Q111646263",name:"Joseph MacTaggert",metronId:30215,into:"Joseph MacTaggert"},
 {qid:"Q111658696",name:"Carmen Pryde",metronId:15937,into:"Carmen Pryde"},
 {qid:"Q111658697",name:"Terri Pryde",metronId:16988,into:"Terri Pryde"},
 {qid:"Q111795164",name:"Raymond Warren",metronId:8784,into:"Raymond Warren"},
 {qid:"Q111795513",name:"Seymour O'Reilly",metronId:25202,into:"Seymour O'Reilly"},
 {qid:"Q111910243",name:"Blackie Gaxton",metronId:30137,into:"Blackie Gaxton"},
 {qid:"Q112065449",name:"Cole",metronId:6474,into:"Cole"},
 {qid:"Q112066657",name:"Macon",metronId:6462,into:"Macon"},
 {qid:"Q112066663",name:"Reese",metronId:6475,into:"Reese"},
 {qid:"Q112075433",name:"Sara Grey-Bailey",metronId:4655,into:"Sara Grey-Bailey"},
 {qid:"Q112085014",name:"Bel-Dann",metronId:11175,into:"Bel-Dann"},
 {qid:"Q114289255",name:"Papa Jambo",metronId:23658,into:"Papa Jambo"},
 {qid:"Q115355305",name:"Lucky Lobo",metronId:25193,into:"Lucky Lobo"},
 {qid:"Q115359812",name:"Barney Bushkin",metronId:25194,into:"Barney Bushkin"},
 {qid:"Q115407242",name:"Joe Smith",metronId:19476,into:"Joe Smith"},
 {qid:"Q115411658",name:"Seidring",metronId:32479,into:"Seidring"},
 {qid:"Q115453803",name:"Igor Drenkov",metronId:20419,into:"Igor Drenkov"},
 {qid:"Q115454999",name:"Mongu",metronId:18407,into:"Mongu"},
 {qid:"Q115659776",name:"Sikorsky",metronId:4770,into:"Sikorsky"},
 {qid:"Q117078144",name:"Sunder",metronId:13763,into:"Sunder"},
 {qid:"Q117194037",name:"Philip Summers",metronId:38368,into:"Philip Summers"},
 {qid:"Q117194038",name:"Deborah Summers",metronId:30159,into:"Deborah Summers"},
 {qid:"Q117306429",name:"Puff",metronId:11307,into:"Puff"},
 {qid:"Q117317232",name:"Naze",metronId:10336,into:"Naze"},
 {qid:"Q119007332",name:"Baxter Bigelow",metronId:25185,into:"Baxter Bigelow"},
 {qid:"Q128907129",name:"Neal Conan",metronId:14439,into:"Neal Conan"},
 {qid:"Q128907490",name:"Gregori Suvorov",metronId:17739,into:"Gregori Suvorov"},
 {qid:"Q12964820",name:"Human Cannonball",metronId:10635,into:"Human Cannonball"},
 {qid:"Q129678764",name:"Judith Rassendyll",metronId:30222,into:"Judith Rassendyll"},
 {qid:"Q135427655",name:"Cybelle",metronId:31908,into:"Cybelle"},
 {qid:"Q138640369",name:"Martha Robertson",metronId:10588,into:"Martha Robertson"},
 {qid:"Q15228910",name:"John Grey",metronId:10743,into:"John Grey"},
 {qid:"Q15229036",name:"Elaine Grey",metronId:10741,into:"Elaine Grey"},
 {qid:"Q15229053",name:"Katherine Summers",metronId:17746,into:"Katherine Summers"},
 {qid:"Q16386845",name:"Magique",metronId:10019,into:"Magique"},
 {qid:"Q16993464",name:"Flashfire",metronId:1914,into:"Flashfire"},
 {qid:"Q17012493",name:"Nightside",metronId:2462,into:"Nightside"},
 {qid:"Q17035845",name:"Tricephalous",metronId:4572,into:"Tricephalous"},
 {qid:"Q17562127",name:"Raksor",metronId:11177,into:"Raksor"},
 {qid:"Q2196544",name:"Lockheed",metronId:4759,into:"Lockheed"},
 {qid:"Q2741605",name:"Donald Pierce",metronId:2160,into:"Donald Pierce"},
 {qid:"Q3080800",name:"Spencer Smythe",metronId:23896,into:"Spencer Smythe"},
 {qid:"Q39052969",name:"Martha Connors",metronId:8726,into:"Martha Connors"},
 {qid:"Q39069914",name:"Billy Connors",metronId:8778,into:"Billy Connors"},
 {qid:"Q4746268",name:"Amiko Kobayashi",metronId:10726,into:"Amiko Kobayashi"},
 {qid:"Q5203157",name:"D'Ken",metronId:4769,into:"D'Ken"},
 {qid:"Q5217006",name:"Daniel Drumm",metronId:6981,into:"Daniel Drumm"},
 {qid:"Q5516076",name:"Gabrielle Haller",metronId:10690,into:"Gabrielle Haller"},
 {qid:"Q5492394",name:"Riptide",metronId:4646,into:"Riptide"},
 {qid:"Q662139",name:"Robert Kelly",metronId:4709,into:"Robert Kelly"},
 {qid:"Q6704798",name:"Lupo",metronId:4923,into:"Lupo"},
 {qid:"Q7614956",name:"Steven Lang",metronId:6486,into:"Steven Lang"},
 {qid:"Q7914646",name:"Vanessa Fisk",metronId:2967,into:"Vanessa Fisk"},
 {qid:"Q8345266",name:"Chester Phillips",metronId:12357,into:"Chester Phillips"},
 {qid:"Q8347897",name:"Phoenix Force",metronId:4684,into:"Phoenix Force"},
 {qid:"Q111375878",name:"Ingar",metronId:29597,into:"Ingar"},
 {qid:"Q111376777",name:"William Drake",metronId:10745,into:"William Drake"},
 {qid:"Q111402887",name:"Judge Chalmers",metronId:31248,into:"Judge Chalmers"},
 {qid:"Q111449447",name:"Angus MacWhirter",metronId:30209,into:"Angus MacWhirter"},
 {qid:"Q111459011",name:"Cr'reee",metronId:17751,into:"Cr'reee"},
 {qid:"Q111472071",name:"Soul-Drinker",metronId:30210,into:"Soul-Drinker"},
 {qid:"Q111493525",name:"Scintilla",metronId:5961,into:"Scintilla"},
 {qid:"Q111506504",name:"Waldo",metronId:30211,into:"Waldo (X-Men)"},
 {qid:"Q111509765",name:"Jahf",metronId:30212,into:"Jahf"},
 {qid:"Q111509930",name:"Modt",metronId:30146,into:"Modt"},
 {qid:"Q111536698",name:"Gary Cody",metronId:29721,into:"Gary Cody"},
 {qid:"Q111537277",name:"Araki",metronId:5962,into:"Araki"},
 {qid:"Q1004568",name:"Human Torch",metronId:1192,into:"Jim Hammond"},
 {qid:"Q2245825",name:"Ace the Bat-Hound",metronId:6364,into:"Ace the Bat-Hound",keepFact:false},
 {qid:"Q252662",name:"Shredder",metronId:22328,into:"Shredder (TMNT)",keepFact:false},
 {qid:"Q2584005",name:"Jackal",metronId:3015,into:"Jackal (Warren)"},
 {qid:"Q4930241",name:"Bluebird",metronId:8782,into:"Sally Avril"},
 {qid:"Q63975143",name:"Spider-Punk",metronId:12347,into:"Spider-Punk",keepFact:false},
 {qid:"Q111312524",name:"Frederick Duncan",metronId:10742,into:"Fred Duncan"},
 {qid:"Q1149808",name:"Brother Voodoo",metronId:708,into:"Doctor Voodoo"},
 {qid:"Q125055539",name:"Stewart Cadwall",metronId:2295,into:"Thundersword"},
 {qid:"Q16592823",name:"Anna Watson",metronId:2964,into:"Anna May Watson"},
 {qid:"Q2504688",name:"Lilandra Neramani",metronId:1399,into:"Lilandra"},
 {qid:"Q258015",name:"Rachel Summers",metronId:2142,into:"Rachel Grey"},
 {qid:"Q2057532",name:"Henry Pym",metronId:378,into:"Hank Pym"},
 {qid:"Q2917078",name:"Mac Gargan",metronId:754,into:"Scorpion (Gargan)"},
 {qid:"Q3640800",name:"Blackie Drago",metronId:2965,into:"Vulture (Drago)"},
 {qid:"Q5515336",name:"Gabe Jones",metronId:4935,into:"Gabriel Jones"},
 {qid:"Q748726",name:"Tabitha Smith",metronId:969,into:"Boom-Boom"},
 {qid:"Q170241",name:"Tarzan",metronId:8432,into:"Tarzan",keepFact:false},
 {qid:"Q1640063",name:"Captain Haddock",metronId:50091,into:"Captain Haddock",keepFact:false},
 {qid:"Q305405",name:"Smurfette",metronId:26550,into:"Smurfette",keepFact:false},
 {qid:"Q3475557",name:"Brainy Smurf",metronId:26680,into:"Brainy Smurf",keepFact:false},
 {qid:"Q939734",name:"Papa Smurf",metronId:26695,into:"Papa Smurf",keepFact:false},
 {qid:"Q715597",name:"Obelix",metronId:45285,into:"Obelix",keepFact:false},
 {qid:"Q7620503",name:"Asterix",metronId:45284,into:"Asterix",keepFact:false},
 {qid:"Q969746",name:"Buck Rogers",metronId:24555,into:"Buck Rogers",keepFact:false},
 {qid:"Q8022656",name:"Wilma Deering",metronId:24972,into:"Wilma Deering",keepFact:false},
 {qid:"Q718806",name:"Proteus",metronId:4382,into:"Proteus (Marvel)",keepFact:false},
 {qid:"Q2283843",name:"Mysterio",metronId:602,into:"Mysterio (Beck)",keepFact:false},
 {qid:"Q111309715",name:"N'Dare",metronId:16987,into:"N'Dare Munroe",keepFact:false},
 {qid:"Q114890103",name:"Frank Castle Jr.",metronId:18658,into:"Francis Castle Jr.",keepFact:false},
 {qid:"Q135186181",name:"Peter Parker",metronId:145,into:"Spider-Man",keepFact:false},
 {qid:"Q1635605",name:"Cuthbert Calculus",metronId:25266,into:"Professor Calculus",keepFact:false},
 {qid:"Q30315324",name:"Baron Zemo",metronId:4364,into:"Baron Heinrich Zemo",keepFact:false},
 {qid:"Q111376791",name:"Madeline Drake",metronId:10744,into:"Maddie Drake",keepFact:false},
 {qid:"Q867810",name:"Clark Kent",metronId:13,into:"Superman",keepFact:false},];
/** Wikidata items whose first-appearance issue must never be attached to the merged Metron character. */
export const MERGE_FACT_EXCLUDED_QIDS:readonly string[]=CHARACTER_MERGES.filter(m=>m.keepFact===false).map(m=>m.qid);

/** Wikidata items that are not comic characters at all; hidden from search, browsing and their own page. */
export const HIDDEN_CHARACTERS:readonly {qid:string;name:string;reason:string}[]=[
 {qid:'Q129628',name:'Yeti',reason:'the folklore creature, not a comic character'},
];
export const HIDDEN_CHARACTER_QIDS:readonly string[]=HIDDEN_CHARACTERS.map(h=>h.qid);
export const isHiddenCharacter=(characterId:number)=>HIDDEN_CHARACTER_QIDS.some(qid=>wikidataCharacterId(qid)===characterId);
/** Takes hidden items out of search and browsing and hides their facts (run after the suppression rules). */
export async function hideNonComicCharacters(db:CatalogDb,qids:readonly string[]=HIDDEN_CHARACTER_QIDS){
 const ids=qids.map(wikidataCharacterId).filter((id):id is number=>id!==null);
 if(!ids.length)return 0;
 const list=sql.join(ids.map(id=>sql`${id}`),sql`, `);
 await db.execute(sql`UPDATE ch_web.character_first_appearances SET suppressed=true WHERE character_id IN (${list}) AND NOT suppressed`);
 const r=await db.execute(sql`UPDATE ch_web.characters SET search_text='',sitelinks=0,updated_at=now() WHERE character_id IN (${list}) AND (search_text<>'' OR COALESCE(sitelinks,0)<>0)`);
 return Number((r as {rowCount?:number}).rowCount||0);
}

type Rows<T>={rows:T[]};
export async function applyCharacterMerges(db:CatalogDb,merges:readonly CharacterMerge[]=CHARACTER_MERGES){
 const report={merged:0,already:0,skipped:[] as string[]};
 for(const m of merges){
  const wid=wikidataCharacterId(m.qid);if(!wid){report.skipped.push(m.qid+' (bad id)');continue}
  const rows=(await db.execute(sql`SELECT character_id,name,merged_into FROM ch_web.characters WHERE character_id IN (${wid},${m.metronId})`) as Rows<{character_id:number;name:string;merged_into:number|null}>).rows;
  const w=rows.find(r=>Number(r.character_id)===wid),t=rows.find(r=>Number(r.character_id)===m.metronId);
  // Guards: both records exist, the Metron record is still the character we checked, nothing is merged twice.
  if(!w||!t){report.skipped.push(`${m.name} (record missing)`);continue}
  if(t.name!==m.into||t.merged_into!==null){report.skipped.push(`${m.name} (Metron record changed: ${t.name})`);continue}
  if(w.merged_into!==null){if(Number(w.merged_into)===m.metronId)report.already++;else report.skipped.push(`${m.name} (already merged elsewhere)`);continue}
  if(m.keepFact!==false)await db.execute(sql`INSERT INTO ch_web.character_first_appearances(character_id,source,source_ref,issue_id,metron_issue_id,series,number,year,match_method,updated_at)
   SELECT ${m.metronId},'wikidata',f.source_ref,f.issue_id,f.metron_issue_id,f.series,f.number,f.year,f.match_method,now() FROM ch_web.character_first_appearances f
   WHERE f.character_id=${wid} AND f.source='wikidata' ON CONFLICT(character_id,source) DO NOTHING`);
  await db.execute(sql`UPDATE ch_web.characters SET wikidata_qid=${m.qid},updated_at=now() WHERE character_id=${m.metronId} AND wikidata_qid IS NULL`);
  await db.execute(sql`UPDATE ch_web.characters SET merged_into=${m.metronId},updated_at=now() WHERE character_id=${wid} AND merged_into IS NULL`);
  report.merged++;
 }
 return report;
}
