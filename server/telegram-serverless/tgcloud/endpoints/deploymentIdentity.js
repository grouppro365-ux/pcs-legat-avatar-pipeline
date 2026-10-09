import {api} from 'sdk';
// Bot identity is public; this probe neither sends messages nor changes a webhook.
export default async function(){
 const bot=await api.getMe();
 if(!bot?.is_bot||typeof bot.username!=='string')throw new Error('bot_identity_unavailable');
 return 'PCS_SERVERLESS_BOT:'+bot.username.toLowerCase();
}
