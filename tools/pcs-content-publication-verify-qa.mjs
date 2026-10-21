import {duplicateFixtureHelper} from './pcs-content-qa-support.mjs';
import {readFileSync} from 'node:fs';
const staff=readFileSync(new URL('../server/sql/pcs_staff_accounts.sql',import.meta.url),'utf8');
const base=readFileSync(new URL('../server/sql/pcs_content_workflow.sql',import.meta.url),'utf8');
const migration=readFileSync(new URL('../server/sql/pcs_content_publication_verify.sql',import.meta.url),'utf8');
const duplicates=readFileSync(new URL('../server/sql/pcs_content_duplicates.sql',import.meta.url),'utf8');
const checks=readFileSync(new URL('../tests/content-publication-verify-rollback.sql',import.meta.url),'utf8');
console.log(JSON.stringify({query:`DO $outer$ BEGIN BEGIN EXECUTE $staff$${staff}$staff$; EXECUTE $base$${base}$base$; EXECUTE $duplicates$${duplicates}$duplicates$; ${duplicateFixtureHelper} EXECUTE $migration$${migration}$migration$; ${checks} RAISE EXCEPTION 'QA rollback complete' USING ERRCODE='Z0001';EXCEPTION WHEN SQLSTATE 'Z0001' THEN NULL;END;END $outer$;`}));
