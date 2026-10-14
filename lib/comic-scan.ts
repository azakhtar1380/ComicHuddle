// Recognition is a suggestion, never an automatic edition/printing assignment.
export function safeScanImage(file:{type:string;size:number}){return ['image/jpeg','image/png','image/webp'].includes(file.type)&&file.size>0&&file.size<=10*1024*1024;}
export function scanSearchText(value:string){return value.replace(/[\u0000-\u001f]/g,' ').replace(/\s+/g,' ').trim().slice(0,160);}
export function recognizedBarcode(value:string){return /^(\d{12}|\d{13}|\d{17}|\d{18})$/.test(value)?value:null;}
export function stopComicCamera(stream:{getTracks:()=>{stop:()=>void}[]}|null){stream?.getTracks().forEach(track=>track.stop());}
