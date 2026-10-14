export function cgcLinks(certificationNumber:string|undefined,title:string,issue:string,certDeepLinkVerified=false){
 const cert=certificationNumber?.trim();
 if(cert&&!/^[0-9]{6,20}$/.test(cert))throw new Error('Invalid certification number');
 return {certificationUrl:cert&&certDeepLinkVerified?'https://www.cgccomics.com/certlookup/'+encodeURIComponent(cert)+'/':'https://www.cgccomics.com/certlookup/',
  requestedCertDeepLink:cert?'https://www.cgccomics.com/certlookup/'+encodeURIComponent(cert)+'/':null,
  populationUrl:cert?'https://www.cgccomics.com/population-report/redirect/certnum/'+encodeURIComponent(cert)+'/':'https://www.cgccomics.com/population-report/',
  searchText:title+' #'+issue,certificationNumber:cert||null};
}
