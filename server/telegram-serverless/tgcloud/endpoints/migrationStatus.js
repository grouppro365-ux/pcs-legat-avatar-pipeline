import {EndpointError} from 'sdk';
export default async function(input,ctx){
 if(!Number.isSafeInteger(ctx?.initData?.user?.id)||ctx.initData.user.id<=0)throw new EndpointError('Откройте приложение в Telegram.',{code:'AUTH_REQUIRED'});
 return {stage:'miniapp-and-api-transport',database:'existing-postgresql',webhook:'existing-gateway',database_migrated:false,webhook_migrated:false};
}
