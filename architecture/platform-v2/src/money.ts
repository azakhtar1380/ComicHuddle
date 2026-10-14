import {DomainError} from './db';
export const MAX_CENTS=BigInt('9007199254740991');
export function cents(value:string|bigint):bigint{
 if(typeof value==='string'&&!/^(0|[1-9]\d*)$/.test(value))throw new DomainError('invalid_money','Use a nonnegative integer-cent string.',400);
 const amount=BigInt(value);if(amount<BigInt(0)||amount>MAX_CENTS)throw new DomainError('invalid_money','Amount is out of range.',400);return amount;
}
export function decimalToCents(value:string):bigint{
 if(!/^(0|[1-9]\d*)(\.\d{1,2})?$/.test(value))throw new DomainError('invalid_decimal','Price must have at most two decimal places.',400);
 const [whole,fraction='']=value.split('.');return cents(BigInt(whole)*BigInt(100)+BigInt(fraction.padEnd(2,'0')));
}
export function amountString(value:bigint):string{cents(value);return (value/BigInt(100)).toString()+'.'+(value%BigInt(100)).toString().padStart(2,'0')}
export function bps(amount:bigint,basisPoints:number):bigint{
 if(!Number.isInteger(basisPoints)||basisPoints<0||basisPoints>10000)throw new DomainError('invalid_rate','Invalid rate.',400);
 return (cents(amount)*BigInt(basisPoints))/BigInt(10000);
}
export function usd(value:string|bigint):string{return '$'+amountString(cents(value))}
