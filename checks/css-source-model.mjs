// A deliberately scoped CSS cascade/box model for source QA, not a renderer.
// Handles this application's width media queries, descendant/child selectors,
// class/id/attribute specificity, source order and the box declarations used
// below. Unsupported selectors do not match; unsupported media queries fail.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

function splitOutside(value,delimiter) {
  const result=[];let start=0,quote='',depth=0;
  for(let i=0;i<value.length;i++){
    const character=value[i];
    if(quote){if(character===quote&&value[i-1]!=='\\')quote='';continue;}
    if(character==='"'||character==="'"){quote=character;continue;}
    if('(['.includes(character))depth++;if(')]'.includes(character))depth--;
    if(!depth&&character===delimiter){result.push(value.slice(start,i));start=i+1;}
  }
  result.push(value.slice(start));return result;
}
function boundary(source,start,delimiter){
  let quote='',depth=0;
  for(let i=start;i<source.length;i++){
    const c=source[i];if(quote){if(c===quote&&source[i-1]!=='\\')quote='';continue;}
    if(c==='"'||c==="'"){quote=c;continue;}
    if('(['.includes(c))depth++;if(')]'.includes(c))depth--;
    if(!depth&&delimiter.includes(c))return i;
  }
  return source.length;
}
function declarations(body){
  const values=[];
  for(const declaration of splitOutside(body,';')){
    const colon=boundary(declaration,0,':');if(colon===declaration.length)continue;
    const property=declaration.slice(0,colon).trim(),raw=declaration.slice(colon+1).trim();
    if(!property||!raw)continue;const important=/!important\s*$/.test(raw),value=raw.replace(/!important\s*$/,'').trim();
    const emit=(name,content)=>values.push({property:name,value:content,important});emit(property,value);
    if(['padding','margin','border-width'].includes(property)){
      const parts=value.split(/\s+/),[top,right=top,bottom=top,left=right]=parts;
      for(const [side,item]of Object.entries({top,right,bottom,left}))emit(property==='border-width'?'border-'+side+'-width':property+'-'+side,item);
    }
    if(property==='padding-inline'||property==='margin-inline'){
      const [left,right=left]=value.split(/\s+/);emit(property.split('-')[0]+'-left',left);emit(property.split('-')[0]+'-right',right);
    }
    if(property==='border'||/^border-(left|right|top|bottom)$/.test(property)){
      const width=value==='0'||value==='none'?'0':value.split(/\s+/).find(part=>/^\d*\.?\d+px$/.test(part));
      if(width)for(const side of property==='border'?['top','right','bottom','left']:[property.slice(7)])emit('border-'+side+'-width',width);
    }
  }
  return values;
}
function mediaMatches(query,width){
  if(/prefers-reduced-motion/.test(query))return false;
  let matches=true;
  const rest=query.replace(/\((min|max)-width\s*:\s*([\d.]+)px\)/g,(_,kind,number)=>{
    matches&&=kind==='max'?width<=Number(number):width>=Number(number);return '';
  }).replace(/\band\b|\bscreen\b|\ball\b/g,'').replace(/\s/g,'');
  assert.equal(rest,'','CSS source model does not support media query '+query);return matches;
}
export function readCssRules(files){
  const rules=[];
  function parse(source,media=[]){
    source=source.replace(/\/\*[\s\S]*?\*\//g,'');let position=0;
    while(position<source.length){
      const opening=boundary(source,position,'{;');
      if(opening===source.length)break;
      if(source[opening]===';'){position=opening+1;continue;}
      const prelude=source.slice(position,opening).trim();let level=1,end=opening+1,quote='';
      for(;end<source.length&&level;end++){
        const c=source[end];if(quote){if(c===quote&&source[end-1]!=='\\')quote='';continue;}
        if(c==='"'||c==="'"){quote=c;continue;}if(c==='{')level++;if(c==='}')level--;
      }
      assert.equal(level,0,'Unbalanced CSS block');const body=source.slice(opening+1,end-1);position=end;
      if(prelude.startsWith('@media'))parse(body,[...media,prelude.slice(6).trim()]);
      else if(!prelude.startsWith('@'))for(const selector of splitOutside(prelude,','))
        rules.push({selector:selector.trim(),media,declarations:declarations(body),order:rules.length});
    }
  }
  for(const file of files)parse(readFileSync(file,'utf8'));return rules;
}
function compounds(selector){
  const result=[];let start=0,depth=0,quote='';
  for(let i=0;i<selector.length;i++){
    const c=selector[i];if(quote){if(c===quote&&selector[i-1]!=='\\')quote='';continue;}
    if(c==='"'||c==="'"){quote=c;continue;}if('(['.includes(c))depth++;if(')]'.includes(c))depth--;
    if(!depth&&(c==='>'||/\s/.test(c))){
      if(i>start)result.push(selector.slice(start,i));if(c==='>')result.push('>');start=i+1;
    }
  }
  if(start<selector.length)result.push(selector.slice(start));return result;
}
function matchCompound(selector,node){
  if(!node)return false;let remaining=selector;
  const tag=remaining.match(/^(\*|[a-zA-Z][\w-]*)/);if(tag){if(tag[1]!=='*'&&tag[1]!==node.tag)return false;remaining=remaining.slice(tag[0].length);}
  while(remaining){
    const part=remaining.match(/^([.#])([\w-]+)/);
    if(part){if(part[1]==='.'?!node.classes.includes(part[2]):node.id!==part[2])return false;remaining=remaining.slice(part[0].length);continue;}
    const attribute=remaining.match(/^\[([\w-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\]\s]+)))?\s*\]/);
    if(attribute){const value=attribute[2]??attribute[3]??attribute[4];if(value===undefined?!Object.hasOwn(node.attributes,attribute[1]):String(node.attributes[attribute[1]])!==value)return false;remaining=remaining.slice(attribute[0].length);continue;}
    if(remaining===':root')return node.tag==='html';
    // Interaction and structural pseudo classes are outside this default-state model.
    return false;
  }
  return true;
}
function matches(selector,chain){
  const parts=compounds(selector);let node=chain.length-1,index=parts.length-1;
  if(!matchCompound(parts[index--],chain[node--]))return false;
  while(index>=0){
    if(parts[index]==='>'){index--;if(!matchCompound(parts[index--],chain[node--]))return false;}
    else {while(node>=0&&!matchCompound(parts[index],chain[node]))node--;if(node<0)return false;node--;index--;}
  }
  return true;
}
function specificity(selector){
  const parts=compounds(selector).filter(value=>value!=='>');
  return [(selector.match(/#[\w-]+/g)||[]).length,(selector.match(/\.[\w-]+|\[[^\]]+\]|:[\w-]+/g)||[]).length,
    parts.filter(part=>/^[a-zA-Z]/.test(part)).length];
}
function stronger(next,old){
  if(!old)return true;for(let i=0;i<next.length;i++){if(next[i]!==old[i])return next[i]>old[i];}return true;
}
export function cssNode(tag,props={}){return {tag,classes:(props.className||'').split(/\s+/).filter(Boolean),id:props.id,attributes:props};}
export function cssAt(rules,chain,width){
  const style={},winners={};
  for(const rule of rules){if(!rule.media.every(query=>mediaMatches(query,width))||!matches(rule.selector,chain))continue;
    for(const [index,declaration]of rule.declarations.entries()){
      const rank=[Number(declaration.important),...specificity(rule.selector),rule.order,index];
      if(stronger(rank,winners[declaration.property])){style[declaration.property]=declaration.value;winners[declaration.property]=rank;}
    }
  }
  return style;
}
export function cssLength(value,reference,auto=reference){
  if(value===undefined||value==='auto'||value==='none')return auto;
  if(value==='0')return 0;
  if(/^\d*\.?\d+px$/.test(value))return Number.parseFloat(value);
  if(/^\d*\.?\d+%$/.test(value))return Number.parseFloat(value)*reference/100;
  const calc=value.match(/^calc\(100% - ([\d.]+)px\)$/);if(calc)return reference-Number(calc[1]);
  throw Error('Unsupported source geometry length '+value);
}
export function horizontalBox(style,parentWidth){
  assert.equal(style['box-sizing'],'border-box','Box geometry requires inherited universal border-box rule');
  const width=Math.max(cssLength(style['min-width'],parentWidth,0),Math.min(cssLength(style.width,parentWidth),cssLength(style['max-width'],parentWidth,Infinity)));
  const padding=cssLength(style['padding-left'],parentWidth,0)+cssLength(style['padding-right'],parentWidth,0);
  const border=cssLength(style['border-left-width'],parentWidth,0)+cssLength(style['border-right-width'],parentWidth,0);
  assert.ok(width>=padding+border,'Horizontal padding/borders must fit');return {width,contentWidth:width-padding-border,padding,border};
}
