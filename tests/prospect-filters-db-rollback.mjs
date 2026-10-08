import {prospectRequestsQuery,prospectSummaryQuery} from '../server/supabase/pcs-manager-live2/prospect-engine.mjs';
const literal=v=>typeof v==='number'?String(v):"'"+v.replaceAll("'","''")+"'";
function list(direction='all',freshness='recent',kind='all',decision='all',offset=0){const q=prospectRequestsQuery(decision,offset,kind,direction,freshness);return q.query.replace(/\$(\d+)\b/g,(_,n)=>literal(q.params[Number(n)-1]));}
function check(expected,...args){return `select array_agg(id order by id) into ids from (${list(...args)}) t;if ids is distinct from array[${expected.map(literal)}]::text[] then raise exception 'filter mismatch: %',ids;end if;`;}
console.log(`do $qa$ declare ids text[];summary jsonb;begin begin
set local search_path=pg_temp,public;
create temp table pcs_prospect_sources(like public.pcs_prospect_sources including all) on commit drop;
create temp table pcs_prospect_requests(like public.pcs_prospect_requests including all) on commit drop;
insert into pcs_prospect_sources(id,username,topic,last_read_at) values('qa-competitor','qa_competitor','competitor',now()),('qa-community','qa_community','community',now());
insert into pcs_prospect_requests(id,source_id,telegram_message_id,message_url,message_text,decision,direction,reason,qualification_version,published_at) values
('car','qa-competitor',1,'https://t.me/qa_competitor/1','Need car','qualified','CAR_RENTAL','QA','QA',now()),
('old','qa-competitor',2,'https://t.me/qa_competitor/2','Old car','qualified','CAR_RENTAL','QA','QA',now()-interval '8 days'),
('community','qa-community',3,'https://t.me/qa_community/3','Want apartment','qualified','PROPERTY_PURCHASE','QA','QA',now()),
('undated','qa-competitor',4,'https://t.me/qa_competitor/4','Missing date','qualified','CAR_RENTAL','QA','QA',null),
('future','qa-competitor',5,'https://t.me/qa_competitor/5','Future car','qualified','CAR_RENTAL','QA','QA',now()+interval '1 day'),
('property','qa-competitor',6,'https://t.me/qa_competitor/6','Apartment query','review','PROPERTY_PURCHASE','QA','QA',now());
${check(['car','community','property'])}
${check(['car'],'CAR_RENTAL')}
${check(['property'],'PROPERTY_PURCHASE','recent','competitor')}
${check(['car','future','old','undated'],'CAR_RENTAL','all','competitor')}
${check(['car'],'all','recent','competitor','qualified')}
${check(['car'],'all','recent','competitor','all',1)}
select to_jsonb(t) into summary from (${prospectSummaryQuery.replace(/\$(\d+)\b/g,(_,n)=>literal(['competitor','PROPERTY_PURCHASE','recent'][Number(n)-1]))}) t;
if summary->>'qualified'<>'0' or summary->>'review'<>'1' or summary->>'sources'<>'1' or summary->>'sources_read'<>'1' then raise exception 'scoped summary mismatch';end if;
raise exception using errcode='Z0001',message='QA rollback';exception when sqlstate 'Z0001' then null;end;end $qa$;`);
