import {createRemoteJWKSet,jwtVerify} from 'npm:jose@6.2.12';
import {authBase} from './portal-account.mjs';
const authKeys=createRemoteJWKSet(new URL(authBase+'/.well-known/jwks.json'));
export const verifyAccount=async(token:string)=>(await jwtVerify(token,authKeys,{issuer:new URL(authBase).origin,audience:new URL(authBase).origin,algorithms:['EdDSA'],requiredClaims:['sub','exp','iat'],maxTokenAge:'16m'})).payload;
