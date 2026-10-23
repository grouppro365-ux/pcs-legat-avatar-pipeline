import {createRemoteJWKSet,jwtVerify} from 'npm:jose@6.2.12';
const githubVideoKeys=createRemoteJWKSet(new URL('https://token.actions.githubusercontent.com/.well-known/jwks'));
export const verifyGithubVideoJWT=(token:string,options:Parameters<typeof jwtVerify>[2])=>jwtVerify(token,githubVideoKeys,options);
