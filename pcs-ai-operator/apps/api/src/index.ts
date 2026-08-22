import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import jwt from '@fastify/jwt';
import rateLimit from '@fastify/rate-limit';
import { config } from '@pcs/backend';
import { registerAuth } from './auth.js';
import { registerRoutes } from './routes.js';

const app=Fastify({logger:{redact:['req.headers.authorization','req.headers.cookie','body.password']},bodyLimit:10*1024*1024});
await app.register(cors,{origin:config.appUrl,credentials:true});
await app.register(cookie);
await app.register(jwt,{secret:config.authSecret,cookie:{cookieName:'pcs_session',signed:false}});
await app.register(rateLimit,{max:300,timeWindow:'1 minute'});
await registerAuth(app);
await registerRoutes(app);
app.setErrorHandler((error,_req,reply)=>{
  app.log.error(error);
  const statusCode=typeof (error as {statusCode?:unknown})?.statusCode==='number' ? (error as {statusCode:number}).statusCode : 500;
  const message=error instanceof Error ? error.message : String(error);
  reply.code(statusCode).send({error:process.env.NODE_ENV==='production'?'Request failed':message});
});
await app.listen({host:'0.0.0.0',port:Number(process.env.PORT??3001)});
