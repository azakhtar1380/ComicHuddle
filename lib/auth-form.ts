export type AuthFields={email:string;password:string;name:string};
export type AuthFieldErrors=Partial<Record<keyof AuthFields,string>>;

/** Normalize identity fields only. Password whitespace is significant. */
export function prepareAuthFields(fields:AuthFields,register:boolean){
 const values={email:fields.email.trim(),password:fields.password,name:fields.name.trim()},errors:AuthFieldErrors={};
 if(!values.email||values.email.length>254||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values.email))errors.email='Enter a complete email address, such as name@example.com.';
 if(!values.password)errors.password='Enter your password.';
 else if(register&&values.password.length<12)errors.password='Use at least 12 characters for your new password.';
 else if(values.password.length>128)errors.password='Use no more than 128 characters.';
 if(register&&(values.name.length<2||values.name.length>60))errors.name='Use a display name between 2 and 60 characters.';
 return {values,errors};
}

export function authErrorMessage(body:unknown,status:number,register:boolean){
 const data=body&&typeof body==='object'?body as Record<string,unknown>:{};
 const code=String(data.code||''),message=String(data.message||'');
 if(status===429)return 'Too many attempts. Wait a minute, then try again.';
 if(/INVALID_EMAIL_OR_PASSWORD|INVALID_PASSWORD|USER_NOT_FOUND/.test(code))return 'The email or password is incorrect. Check both and try again.';
 if(/USER_ALREADY_EXISTS|EMAIL_ALREADY_EXISTS/.test(code))return 'An account already uses that email. Choose Log In instead.';
 if(/PASSWORD_TOO_SHORT/.test(code))return 'Use at least 12 characters for your new password.';
 if(/PASSWORD_TOO_LONG/.test(code))return 'Use no more than 128 characters.';
 if(/INVALID_EMAIL/.test(code)||/string.*match|invalid.*email|pattern/i.test(message))return 'Check your email address. Remove spaces and enter the full address, including its domain.';
 if(status>=500)return 'The account service could not connect. Your details have not been changed. Please retry.';
 if(/INVALID_ORIGIN|INVALID_CALLBACK_URL/.test(code))return 'Please reopen the sign-in page from ComicHuddle and try again.';
 return register?'Your account could not be created. Check your email, display name and password, then retry.':'Could not log in. Check your email and password, then retry.';
}
