-- Private generated content; no anon/authenticated direct storage policy.
INSERT INTO storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
VALUES('pcs-content-video','pcs-content-video',false,26214400,ARRAY['video/mp4','image/png'])
ON CONFLICT(id) DO NOTHING;
DO $check$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM storage.buckets WHERE id='pcs-content-video' AND public=false AND file_size_limit<=26214400 AND file_size_limit>0 AND allowed_mime_types @> ARRAY['video/mp4','image/png'])
 THEN RAISE EXCEPTION 'content_video_bucket_configuration_conflict'; END IF;
END $check$;
