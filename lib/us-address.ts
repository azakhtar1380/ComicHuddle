import {z} from 'zod';
/** A US shipping address, as checkout and saved cards accept it. */
const line=(max:number)=>z.string().trim().min(1).max(max).refine(s=>!/[\u0000-\u001f\u007f]/.test(s));
export const US_STATES=new Set('AL AK AZ AR CA CO CT DE FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY DC'.split(' '));
export const usAddressSchema=z.object({name:line(100),line1:line(160),line2:z.string().trim().max(160).default(''),city:line(100),state:z.string().refine(v=>US_STATES.has(v)),postalCode:z.string().regex(/^\d{5}(?:-\d{4})?$/),country:z.literal('US')}).strict();
export type UsAddress=z.infer<typeof usAddressSchema>;
