# PCS design QA

Source visual truth: supplied `upload/image(3).png`, 1536×1024, reference collage of mobile Client screens in light and dark; supplied original RGBA logo 2048×682.

Implementation evidence: `/workspace/scratch/pcs-transparent-logo-check.jpg`, 1310×270 crop of the browser-rendered existing Operator Inbox. Browser viewport 1363×936, CSS density 1. This is a focused transparent-logo check, not a like-for-like Client screen comparison.

Verified: logo file SHA matches original exactly; alpha range 0–255; image and container background have no black backing. Original white logo renders over existing photographic header and navigation. Light/dark/system control is functional; 7 tests pass. Root transition retains Dashboard class and horizontal overflow was false. Browser errors observed were extension metadata errors; no application error was observed in inspected login state. Authenticated UI was inspected read-only.

Typography/layout/colors/images/copy: shared semantic tokens and existing font stack bridge the current UI. The selected reference requires Client screens; Operator wording and operational modules were preserved intentionally. Full typography/rhythm/image/card fidelity comparison against the Client reference is not yet valid because the existing Client frontend source is unavailable. Mobile and complete light-role checks are still outstanding.

History: initial black CSS backing behind the unchanged original was removed after user correction. Browser confirmed computed parent background rgba(0,0,0,0). Existing dashboard body class loss was diagnosed from DOM and fixed; oversize navigation icons were resolved. Relative hero search/shortcut offsets and narrow desktop width were subsequently corrected; broader recapture is still required.

Findings: [P1] Full Client Home benchmark cannot be evaluated against the source until the existing Client frontend is obtained. [P2] Full role/mobile/light coverage remains incomplete. Do not report full redesign or production deployment as complete.

final result: blocked
