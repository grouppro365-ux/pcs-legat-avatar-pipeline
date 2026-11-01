# Approved video → existing Telegram publication queue

No real send or provider target creation during development. Existing Neon access recovered on 2026-11-01; canonical rollback QA passed on the existing QA branch. Reuse public.pcs_workflow_outbox (video generation) + pcs.content_publication_jobs (publication); no new queue/CRM/host. Old TEXT path must remain unchanged. Caption PR110 and metrics PR116 are merged; preserve both features.

## Request and frozen job

API action `schedule-video-publication` maps SQL action `schedule-video`. Input is existing schedule fields `{request_id,id,expected_version,target_id,target_version,scheduled_at,publication_confirmed:true}` plus `{video_job_id,video_version,artifact_sha256,video_confirmed:true}`. No browser URLs, captions or artifact objects accepted. Video caption is exactly approved rev.body, ≤1024 Unicode codepoints; never truncate. Both content approval and exact video artifact approval are mandatory.

Add publication job `media_kind` TEXT default or VIDEO, and `video_snapshot` JSONB nullable. TEXT always null snapshot, VIDEO object. Snapshot minimal keys `{id,version,claim_id,revision,brand_version,spec,artifact,review}` copied from canonical READY video job (id from outbox.id, other keys from payload). Source job event CONTENT_VIDEO_GENERATION aggregate CONTENT_POST and aggregate_id=post.id, status SENT, payload.stage READY, review_status APPROVED, review.decision APPROVED, review.artifact_sha256==artifact.sha256==input hash, payload.version==input video_version, current revision/brand/source check via pcs.content_video_current(job). Review note/checked_at already canonical; do not accept fabricated browser evidence.

Scheduling reuses post/brand/target locks, exact target version/identity, existing global command idempotency/audit, and one publication job per post/revision. Reschedule only CANCELLED/REJECTED/BLOCKED; never SENDING/UNKNOWN/SENT. Text reschedule clears snapshot. At claim recheck video version, stage/review, full artifact/spec/claim/review equality and source validity; stale data => BLOCKED reason video_changed, definitely no send. Preserve source immutable snapshot, do not regenerate GPU.

Prevent canonical video review mutation for a referenced VIDEO publication in SENDING/UNKNOWN/SENT, to avoid review-revocation during upload/unknown result. QUEUED can be rejected; claim must then block. Use consistent post→brand→outbox lock ordering. Public functions/grants remain restricted; current permissions are server-derived.

## Transport

`deliverTelegramPublication(base,key,job,transport=fetch,options={storage})` retains existing TEXT behavior. VIDEO uses fixed private bucket pcs-content-video and exact object path jobs/<video id>/<claim uuid>/final.mp4, never a user URL or signed URL. Validate frozen technical metadata via existing storage checks, download exact bytes once, verify MP4 signature, byte count and SHA256 before constructing grammY InputFile(Uint8Array,'pcs-video.mp4'). No raw private blobs in response/logs/artifacts. Storage timeout/failure/hash mismatch before send => REJECTED reason video_preflight_failed. Target preflight still uses existing bot/channel/right checks.

Use existing pinned grammY1.46.0 (MIT) and reproducible bundle; export InputFile. Keep existing publicationTelegramApi allowlist text-only. Add videoPublicationTelegramApi with sendVideo and preflight methods, no retry plugins. Upload video bytes with exact caption, width/height and supports_streaming:true. Do not send a remote URL, file_id shortcut, or PNG cover. Telegram creates its own preview; UI must disclose this. No claim that platform does not transcode.

Validate message id/chat id/channel username/caption/date as old sender. Video receipt must include bounded nonempty file_id/file_unique_id, matching width/height, integer duration within 1s of source; file_size nullable when omitted, otherwise positive safe integer bounded. SENT result exact keys `{outcome:'SENT',chat_id,caption,message_id,date,artifact_sha256,video:{file_id,file_unique_id,width,height,duration,file_size}}`. artifact_sha256 is verified UPLOADED SOURCE hash, not a post-download/platform hash. SQL complete validates against frozen snapshot and stores receipt; note receipt acceptance vs independent public media QA.

Once external send attempted: malformed/mismatched receipt/network timeout => UNKNOWN (receipt_invalid/transport_unknown). No automatic repeat; failed receipt save never triggers second send. Explicit Telegram4xx rejection other than408 is REJECTED provider_rejected, as old text path. Reject blank/too-long captions before send.

## API/UI capability

readContentWorkflow checks installed SQL support (e.g video_snapshot column) before advertising capabilities.video_publication.version=1. Fetch at most21 eligible video job projections for selected post, expose first20 +truncation; no private file bytes or signed URLs. Return `approved_videos` entries `{id,version,revision,brand_version,artifact_sha256,preset,width,height,duration_seconds}`. Only valid READY+APPROVED current-source jobs appear.

Extend existing publication form with explicit TEXT/VIDEO choice default TEXT; video requires selecting exact approved file hash, video_confirmed checkbox and caption≤1024, existing target/time/publication confirmation. Hide video controls without exact capability or permission/eligible file; no implicit activation of an old pending text draft. Snapshot selected video/version/hash in stable request_id signature, freeze fields in flight, scope callbacks to original form+view+sheet. Show saved media_kind and brief source hash; distinguish UNKNOWN and acceptance from public/visual verification. Existing cancel applies to both.

Runtime index.ts passes existing Supabase storage client to sender via options. No real channel or bot token is exposed to browser. Read-only tests use fake target/transport/storage and synthetic MP4 bytes. SQL tests execute actual production functions in ephemeral PGlite with minimal canonical fixtures (not Neon). Canonical rollback QA is provided by tools/pcs-content-video-publication-qa.mjs and passed on the existing QA branch on 2026-11-01, including the existing TEXT lifecycle. The transaction left no synthetic tables or records.

## Validation boundaries — 2026-11-01

1,274 local regressions pass. Coverage includes actual multipart video bytes through grammY, 10 real PGlite SQL/read suites, mobile form lifecycle/consent and old TEXT behavior. Independent review caught a numeric-duration projection mismatch; the query now returns double precision and the real SQL test checks the numeric API value. No real publication target or real send was used. Provider-accepted receipts do not establish independent public video-content or visual acceptance.

The existing v1 internal technical generation reached READY with verified 1280×720 H.264, 24 fps, 51 frames, 2.125 s and private storage. Editor review remains PENDING. Caption v2 technical job d58abe52-e5ce-4e71-bec4-1a8455cb1d8f is queued for the existing cloud worker; it is explicitly marked never to publish. This is not a completed v2 GPU or commercial acceptance.
