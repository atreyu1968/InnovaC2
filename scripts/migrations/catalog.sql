-- PostgreSQL 16 schema fingerprint. No row contents, credentials or sequence
-- counters are collected. Object names, not OIDs, identify dependencies.
-- Fingerprints also apply the narrowly scoped, equivalent AND-range normalization in core.mjs.
WITH objects AS (
 SELECT 'relation:'||c.relname AS key,
 jsonb_build_object('kind',c.relkind,'persistence',c.relpersistence,
 'rls',c.relrowsecurity,'forceRls',c.relforcerowsecurity,
 'replicaIdentity',c.relreplident,'options',c.reloptions,
 'partition',pg_get_partkeydef(c.oid),'bound',pg_get_expr(c.relpartbound,c.oid),
 'access',a.amname) AS value
 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 LEFT JOIN pg_am a ON a.oid=c.relam WHERE n.nspname='public'
 UNION ALL
 SELECT 'column:'||c.relname||'.'||a.attname,
 jsonb_build_object('type',format_type(a.atttypid,a.atttypmod),
 'nullable',NOT a.attnotnull,'default',pg_get_expr(d.adbin,d.adrelid),
 'identity',a.attidentity,'generated',a.attgenerated,'storage',a.attstorage,
 'compression',a.attcompression,'dimensions',a.attndims,
 'collation',CASE WHEN a.attcollation=0 THEN NULL ELSE a.attcollation::regcollation::text END)
 FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid
 JOIN pg_namespace n ON n.oid=c.relnamespace
 LEFT JOIN pg_attrdef d ON d.adrelid=c.oid AND d.adnum=a.attnum
 WHERE n.nspname='public' AND a.attnum>0 AND NOT a.attisdropped
 AND c.relkind NOT IN ('i','I','S')
 UNION ALL
 SELECT 'constraint:'||COALESCE(c.relname,t.typname)||'.'||x.conname,
 jsonb_build_object('definition',pg_get_constraintdef(x.oid,false),
 'validated',x.convalidated,'deferred',x.condeferred,'deferrable',x.condeferrable,
 'local',x.conislocal,'inherit',x.connoinherit)
 FROM pg_constraint x JOIN pg_namespace n ON n.oid=x.connamespace
 LEFT JOIN pg_class c ON c.oid=x.conrelid LEFT JOIN pg_type t ON t.oid=x.contypid
 WHERE n.nspname='public'
 UNION ALL
 SELECT 'index:'||c.relname,
 jsonb_build_object('definition',pg_get_indexdef(i.indexrelid),
 'valid',i.indisvalid,'ready',i.indisready,'live',i.indislive,
 'clustered',i.indisclustered,'replicaIdentity',i.indisreplident)
 FROM pg_index i JOIN pg_class c ON c.oid=i.indexrelid
 JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public'
 UNION ALL
 SELECT 'trigger:'||c.relname||'.'||t.tgname,
 jsonb_build_object('definition',pg_get_triggerdef(t.oid,false),'enabled',t.tgenabled)
 FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid
 JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname='public' AND NOT t.tgisinternal
 UNION ALL
 SELECT 'internal-trigger:'||c.relname||'.'||x.conname||'.'||t.tgtype,
 jsonb_build_object('function',p.proname,'enabled',t.tgenabled,
 'deferrable',t.tgdeferrable,'deferred',t.tginitdeferred)
 FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid
 JOIN pg_namespace n ON n.oid=c.relnamespace
 JOIN pg_constraint x ON x.oid=t.tgconstraint JOIN pg_proc p ON p.oid=t.tgfoid
 WHERE n.nspname='public' AND t.tgisinternal
 UNION ALL
 SELECT 'function:'||p.proname||'('||pg_get_function_identity_arguments(p.oid)||')',
 jsonb_build_object('definition',pg_get_functiondef(p.oid))
 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname='public' AND p.prokind<>'a'
 UNION ALL
 SELECT 'type:'||t.typname,
 jsonb_build_object('kind',t.typtype,'category',t.typcategory,
 'base',format_type(t.typbasetype,t.typtypmod),'notNull',t.typnotnull,
 'default',t.typdefault,'enum',(SELECT jsonb_agg(e.enumlabel ORDER BY e.enumsortorder)
 FROM pg_enum e WHERE e.enumtypid=t.oid))
 FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace
 WHERE n.nspname='public' AND t.typrelid=0 AND t.typelem=0
 UNION ALL
 SELECT 'sequence:'||c.relname,
 jsonb_build_object('type',format_type(s.seqtypid,NULL),'start',s.seqstart,
 'increment',s.seqincrement,'min',s.seqmin,'max',s.seqmax,'cache',s.seqcache,
 'cycle',s.seqcycle,'ownedBy',(SELECT jsonb_agg(
 jsonb_build_array(r.relname,a.attname,d.deptype) ORDER BY r.relname,a.attname)
 FROM pg_depend d JOIN pg_class r ON r.oid=d.refobjid
 JOIN pg_attribute a ON a.attrelid=r.oid AND a.attnum=d.refobjsubid
 WHERE d.classid='pg_class'::regclass AND d.objid=c.oid AND d.deptype IN ('a','i')))
 FROM pg_sequence s JOIN pg_class c ON c.oid=s.seqrelid
 JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public'
 UNION ALL
 SELECT 'policy:'||c.relname||'.'||p.polname,
 jsonb_build_object('command',p.polcmd,'permissive',p.polpermissive,
 'roles',(SELECT jsonb_agg(CASE WHEN r=0 THEN 'public' ELSE pg_get_userbyid(r) END
 ORDER BY r) FROM unnest(p.polroles) r),
 'using',pg_get_expr(p.polqual,p.polrelid),'check',pg_get_expr(p.polwithcheck,p.polrelid))
 FROM pg_policy p JOIN pg_class c ON c.oid=p.polrelid
 JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public'
 UNION ALL
 SELECT 'rule:'||c.relname||'.'||r.rulename,
 jsonb_build_object('definition',pg_get_ruledef(r.oid,false),'enabled',r.ev_enabled)
 FROM pg_rewrite r JOIN pg_class c ON c.oid=r.ev_class
 JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public'
 UNION ALL
 SELECT 'inherit:'||c.relname||'.'||p.relname,to_jsonb(i.inhseqno)
 FROM pg_inherits i JOIN pg_class c ON c.oid=i.inhrelid
 JOIN pg_class p ON p.oid=i.inhparent
 JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public'
 UNION ALL
 SELECT 'extension:'||e.extname,jsonb_build_object('version',e.extversion,'schema',n.nspname)
 FROM pg_extension e JOIN pg_namespace n ON n.oid=e.extnamespace
 WHERE e.extname<>'plpgsql'
 UNION ALL
 -- None of these are used by this application's migrations. Refuse to silently
 -- baseline databases with extra schemas or unmodelled advanced objects.
 SELECT 'extra-schema:'||nspname,to_jsonb(nspname) FROM pg_namespace
 WHERE nspname NOT IN ('public','drizzle','information_schema') AND nspname NOT LIKE 'pg_%'
 UNION ALL
 SELECT 'unsupported:'||x.type||':'||x.name,to_jsonb(x.name) FROM (
 SELECT 'event-trigger' AS type,evtname AS name FROM pg_event_trigger
 UNION ALL SELECT 'publication',pubname FROM pg_publication
 UNION ALL SELECT 'foreign-server',srvname FROM pg_foreign_server
 UNION ALL SELECT 'collation',c.collname FROM pg_collation c JOIN pg_namespace n ON n.oid=c.collnamespace WHERE n.nspname='public'
 UNION ALL SELECT 'aggregate',p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.prokind='a'
 UNION ALL SELECT 'statistics',s.stxname FROM pg_statistic_ext s JOIN pg_namespace n ON n.oid=s.stxnamespace WHERE n.nspname='public'
 UNION ALL SELECT 'operator',o.oprname FROM pg_operator o JOIN pg_namespace n ON n.oid=o.oprnamespace WHERE n.nspname='public'
 UNION ALL SELECT 'text-search',c.cfgname FROM pg_ts_config c JOIN pg_namespace n ON n.oid=c.cfgnamespace WHERE n.nspname='public'
 ) x
)
SELECT key,value FROM objects ORDER BY key;
