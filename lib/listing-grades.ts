// Plain-English names for the standard 10-point comic grading scale (the same scale CGC uses),
// so sellers and collectors can pick a grade without memorising numbers.
export const gradeNames:Record<string,string>={
 '10.0':'Gem Mint','9.9':'Mint','9.8':'Near Mint/Mint','9.6':'Near Mint+','9.4':'Near Mint','9.2':'Near Mint−','9.0':'Very Fine/Near Mint',
 '8.5':'Very Fine+','8.0':'Very Fine','7.5':'Very Fine−','7.0':'Fine/Very Fine','6.5':'Fine+','6.0':'Fine','5.5':'Fine−','5.0':'Very Good/Fine',
 '4.5':'Very Good+','4.0':'Very Good','3.5':'Very Good−','3.0':'Good/Very Good','2.5':'Good+','2.0':'Good','1.8':'Good−','1.5':'Fair/Good','1.0':'Fair','0.5':'Poor'
};
/** "9.4 · Near Mint" when the number is on the scale, otherwise the value unchanged. */
export function gradeLabel(grade:string){const name=gradeNames[grade];return name?grade+' · '+name:grade}
/** A few common raw-copy shorthands for quick picks in the collection form. */
export const quickGrades:{label:string;value:string}[]=[
 {label:'Near Mint',value:'Raw NM'},{label:'Very Fine',value:'Raw VF'},{label:'Fine',value:'Raw FN'},{label:'Very Good',value:'Raw VG'},{label:'Good',value:'Raw GD'},
 {label:'CGC 9.8',value:'CGC 9.8'},{label:'CGC 9.6',value:'CGC 9.6'},{label:'CGC 9.4',value:'CGC 9.4'}
];
