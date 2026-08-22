import type { FastifyInstance, FastifyRequest } from 'fastify';
import argon2 from 'argon2';
import { db, config } from '@pcs/backend';

export async function registerAuth(app: FastifyInstance) {
  app.post('/auth/login', async (req, reply) => {
    const { email, password } = (req.body ?? {}) as any;
    const user = typeof email==='string' ? await db.user.findUnique({where:{email}}) : null;
    if (!user || typeof password!=='string' || !(await argon2.verify(user.passwordHash,password))) return reply.code(401).send({error:'Invalid credentials'});
    const token = await reply.jwtSign({sub:user.id,email:user.email},{expiresIn:'12h'});
    reply.setCookie('pcs_session',token,{httpOnly:true,secure:process.env.NODE_ENV==='production',sameSite:'strict',path:'/',maxAge:43200});
    return {ok:true,user:{id:user.id,email:user.email}};
  });
  app.post('/auth/logout', async (_req, reply) => { reply.clearCookie('pcs_session',{path:'/'}); return {ok:true}; });
  app.get('/auth/me',{preHandler:[requireAuth]},async (req:any)=>({user:req.user}));
}

export async function requireAuth(req: FastifyRequest, reply: any) {
  try { await req.jwtVerify(); }
  catch { return reply.code(401).send({error:'Unauthorized'}); }
  const method = req.method.toUpperCase();
  if (!['GET','HEAD','OPTIONS'].includes(method)) {
    const origin = req.headers.origin;
    if (origin && origin !== config.appUrl) return reply.code(403).send({error:'Origin rejected'});
  }
}
