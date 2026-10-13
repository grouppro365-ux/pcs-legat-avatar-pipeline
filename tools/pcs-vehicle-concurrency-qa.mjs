import {readFileSync} from 'node:fs';import {randomUUID} from 'node:crypto';
const car=process.argv[2]||randomUUID();if(!/^[a-f0-9-]{36}$/.test(car))throw Error('Invalid QA vehicle id');
const sql=readFileSync(new URL('../server/sql/pcs_vehicle_availability_guard.sql',import.meta.url),'utf8');
const statements=[];let body='',quoted=false;
for(let i=0;i<sql.length;){if(sql.startsWith('$fn$',i)){quoted=!quoted;body+='$fn$';i+=4;continue;}const c=sql[i++];body+=c;if(c===';'&&!quoted){statements.push(body.trim());body='';}}
const seed=`insert into public.catalog_items(id,public_id,title,entity_type) values('${car}','PCS-QA-CONCURRENCY-${car}','Synthetic QA concurrency vehicle','VEHICLE')`;
function contender(statement){return `DO $qa$ DECLARE began timestamptz:=clock_timestamp(); blocked boolean:=false; BEGIN BEGIN ${statement}; EXCEPTION WHEN exclusion_violation THEN blocked:=true; END; IF NOT blocked THEN RAISE EXCEPTION 'QA concurrent conflict escaped';END IF; IF extract(epoch from clock_timestamp()-began)<1 THEN RAISE EXCEPTION 'QA concurrency not observed';END IF; END $qa$`;}
console.log(JSON.stringify({car,setup:[...statements,seed],first:{beacon:862341001,
 owner:`DO $qa$ BEGIN INSERT INTO public.availability_periods(item_id,starts_at,ends_at,status) VALUES('${car}','2111-01-10 00:00+07','2111-01-20 00:00+07','BLOCKED'); PERFORM pg_advisory_xact_lock(862341001); PERFORM pg_sleep(30); END $qa$`,
 contender:contender(`INSERT INTO public.applications(public_id,category,item_id,operational_status,qualification_data) VALUES('QA-'||gen_random_uuid(),'booking','${car}','CONFIRMED','{"start_date":"2111-01-12","end_date":"2111-01-14"}')`)},
 second:{beacon:862341002,
 owner:`DO $qa$ BEGIN INSERT INTO public.applications(public_id,category,item_id,operational_status,qualification_data) VALUES('QA-'||gen_random_uuid(),'booking','${car}','CONFIRMED','{"start_date":"2111-04-12","end_date":"2111-04-14"}'); PERFORM pg_advisory_xact_lock(862341002); PERFORM pg_sleep(45); END $qa$`,
 contender:contender(`INSERT INTO public.availability_periods(item_id,starts_at,ends_at,status) VALUES('${car}','2111-04-10 00:00+07','2111-04-20 00:00+07','HOLD')`)} }));
