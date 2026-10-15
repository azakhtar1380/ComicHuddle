export const runtime='nodejs';
export const dynamic='force-dynamic';
const retired=()=>Response.json({status:'deferred',message:'This feature is outside the current launch scope.',upcomingUrl:'/upcoming#fmv'},{status:410,headers:{'Cache-Control':'no-store'}});
export const GET=retired;
export const POST=retired;
