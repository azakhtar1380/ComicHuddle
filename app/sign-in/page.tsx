import SignInForm from './sign-in-form';
export default async function SignInPage({searchParams}:{searchParams:Promise<{mode?:string}>}){const params=await searchParams;return <SignInForm initialRegister={params.mode==='register'}/>;}
