# AIVision production roadmap

## Purpose

This document records two plans:

1. how to add the future Czech-facing vehicle groups `O`, `NA`, `K`, `M`, and `A` without pretending that the current COCO detector can provide them; and
2. how to move the current browser application from a strong local pilot to a trustworthy, auditable production traffic-counting tool.

The maintained product is the React/Vite application under `web/`. The Flutter tree remains a future native shell and is not part of this roadmap unless a native/mobile product is explicitly commissioned.

## Current position

The web application already has a sound counting baseline:

- deterministic video-time sampling in `web/src/services/videoProcessor.ts`;
- local YOLOv10-N/YOLOv10-M inference in `web/src/services/vehicleDetector.ts`;
- confirmed-track, bounded-line crossing in `web/src/lib/trafficCounter.ts`;
- horizontal and vertical zones with four screen-space directions;
- Standard and versioned Night CLAHE preprocessing;
- per-zone, per-direction, and per-class summaries; and
- event CSV, summary CSV, and JSON export.

The current application is nevertheless a **pilot, not yet a validated measurement system**. Its tests establish important software contracts, but there is no held-out, manually adjudicated road-video benchmark establishing real-world count accuracy. It also lacks session persistence, evidence-backed review, immutable run provenance, production deployment automation, and end-to-end browser/model tests.

The current model outputs only COCO `car`, `truck`, `bus`, and `motorcycle`. It does not distinguish vans from rigid goods vehicles or rigid trucks from trailer/semitrailer combinations.

## Production definition

For this project, “production-ready” should mean all of the following:

- **Trustworthy:** accuracy is measured on representative, held-out footage by class, direction, zone, lighting, and camera.
- **Auditable:** every reported crossing can be traced to the input, timestamp, evidence, frozen configuration, model, and application build that produced it.
- **Correctable:** an operator can reject false events, add missed events, change a misclassified event, and preserve both the machine result and correction history.
- **Recoverable:** a browser crash, machine restart, corrupt clip, decoder error, or model failure does not silently lose or misstate a session.
- **Reproducible:** the input fingerprint, actual inference device and dtype, model checksum, preprocessing profile, thresholds, sampling rate, and zones are recorded.
- **Deployable:** the app runs from a versioned production build with the required security/isolation headers rather than a Vite development server.
- **Operable:** valid zero-traffic sessions, long recordings, batch jobs, unsupported codecs, storage limits, and failures have explicit workflows.
- **Maintainable:** CI exercises unit, integration, real-browser, model-asset, and representative-video regressions.

---

# Deferred O/NA/K/M/A classification plan

## 1. Freeze the semantic contract before collecting labels

Use this project-facing taxonomy:

| Code | Meaning | Inclusion rule |
| --- | --- | --- |
| `O` | Passenger and light vehicles | Cars, SUVs, MPVs, passenger minivans, and vans under the agreed project rule |
| `NA` | Rigid goods vehicles | Pickups, solo box/flatbed/dump/tanker/utility trucks, and tractor units without trailers |
| `K` | Goods-vehicle combinations | Tractor-semitrailers and rigid goods vehicles towing freight trailers; count the complete combination once |
| `M` | Motorcycles | Motorcycles, scooters, mopeds, and motorcycle-like motor vehicles |
| `A` | Buses | City buses, coaches, articulated buses, and buses with trailers |

`NA` is a **project alias** for the rigid-goods category normally denoted `N` in the Czech minimum taxonomy. It must not be described as an official “small truck” code. `K` means a trailer/semitrailer combination, not a visually large rigid truck. Preserve an optional `sizeBand: light | medium | heavy | unknown` annotation if later reporting needs rigid-truck size.

A camera cannot reliably establish legal payload, homologated mass, or seat count. Annotation rules must therefore be visual and repeatable, with an `uncertain` outcome for genuinely unresolved examples.

Authoritative background:

- [TP 189 — Stanovení intenzit dopravy na pozemních komunikacích](https://pjpk.rsd.cz/data/USR_001_2_8_TP/TP_189_2018_final.pdf)
- [Czech Ministry of Transport, Manual 2025](https://md.gov.cz/getattachment/Dokumenty/Strategie/Hluk/Aktualizace-Manual-2018/23-0037-01_Manual_2025_FINAL.pdf.aspx)
- [ŘSD CSD2020 technical specification](https://smlouvy.gov.cz/smlouva/soubor/12623651/Smlouva%20CSD2020%20prilohy%20an.pdf)

**Gate:** the product owner signs off one written rubric, including vans, pickups, solo tractor units, passenger cars with trailers, articulated buses, hidden couplings, and uncertain examples. No training begins before this gate.

## 2. Resolve data rights and governance

MIO-TCD is an optional seed dataset, not a production dependency by assumption. Its official classification labels map well:

| MIO-TCD class | Target group |
| --- | --- |
| `Car`, `Work van` | `O` |
| `Pickup truck`, `Single unit truck` | `NA` |
| `Articulated truck` | `K` |
| `Motorcycle` | `M` |
| `Bus` | `A` |

The official dataset contains 648,959 classification crops and 137,743 localization images, but it is North American traffic-camera data and does not guarantee transfer to this camera, European vehicles, or Night CLAHE input.

MIO-TCD is published under **CC BY-NC-SA 4.0**. Not selling this application does not by itself establish noncommercial use; internal workplace use may still be directed toward commercial advantage. Before downloading or using it for training, record one of:

- organizational approval that the intended use satisfies the license;
- separate written permission from the rights holder; or
- a decision to exclude MIO-TCD and use only locally owned/permissively licensed footage.

Sources:

- [Official MIO-TCD dataset and license](https://tcd.miovision.com/challenge/dataset.html)
- [MIO-TCD paper record, DOI 10.1109/TIP.2018.2848705](https://pubmed.ncbi.nlm.nih.gov/29994117/)
- [CC BY-NC-SA 4.0 legal code](https://creativecommons.org/licenses/by-nc-sa/4.0/legalcode.en)

Create a source manifest for every dataset containing its origin, version, checksum, license, allowed use, retention policy, and whether redistribution is allowed. Confirm that workplace footage may be used for training and whether plates, faces, or location metadata require additional controls.

**Gate:** no image enters the training corpus without a recorded source and approved usage basis.

## 3. Build the annotation and benchmark foundation

This should reuse the production event-review work described later in this roadmap. For each physical vehicle track, retain three to five useful observations rather than treating every adjacent frame as an independent example.

Each labeled track should record at least:

- source-video fingerprint and camera/site ID;
- recording/date group used for dataset splitting;
- track ID and relevant timestamps;
- target group and `uncertain` flag;
- original COCO detector class and confidence;
- day/night and preprocessing profile;
- direction/lane or zone;
- occlusion, truncation, blur, and whether a trailer/coupling is visible;
- selected full-vehicle crops and their bounding boxes; and
- reviewer identity/version and correction history.

Preserve the entire vehicle aspect ratio. Use padded letterboxing; do not center-crop long trucks, trailers, articulated buses, or extreme-aspect-ratio vehicles.

Split by source recording, date, and camera—not randomly by crop. All frames from one physical track must remain in one split. Maintain a final holdout that is not used for threshold selection.

The holdout must cover both directions, near/far lanes, day, dusk, ordinary night, wet/reflection conditions, Standard input, Night input, partial occlusion, adjacent vehicles, and each target class.

**Gate:** automated leakage checks prove that no track or source clip crosses train/validation/holdout boundaries, and a second reviewer adjudicates an agreed sample of ambiguous labels.

## 4. Train a compact classifier on available hardware

Do not train a detector from scratch. Start with a compact ImageNet-pretrained classifier such as a MobileNetV3- or EfficientNet-B0-scale network:

1. remap approved source labels to `O/NA/K/M/A` plus an internal `OTHER_OR_UNCERTAIN` rejection class;
2. create a class-balanced subset and deterministic manifest;
3. train the new classification head with the feature backbone frozen;
4. unfreeze only the final backbone stages and fine-tune at a low learning rate;
5. use deployment-faithful letterboxing and color handling;
6. evaluate Standard and Night inputs independently; and
7. retain the training seed, code revision, hyperparameters, label map, and metrics.

The current Ryzen 7 PRO 8840U workstation has 16 logical CPU threads and 61 GiB RAM, which is sufficient for this transfer-learning path. A balanced subset and head-first training may take hours or an overnight run; benchmark a short epoch before projecting the full run. Do not spend engineering time forcing unsupported CUDA/ROCm paths on the integrated Radeon 780M.

A private rented GPU is an optional acceleration, not a prerequisite. Workplace footage must not be uploaded to a notebook or cloud provider unless data policy permits it.

**Gate:** the run is reproducible from a versioned manifest, and training/validation curves do not indicate unresolved underfitting, overfitting, or class-collapse.

## 5. Evaluate category and end-to-end counting quality

Evaluate more than top-1 image accuracy:

- per-class precision, recall, F1, and support;
- complete confusion matrix, especially `O↔NA`, `NA↔K`, and `NA↔A`;
- calibration and confidence/rejection curves;
- performance by camera, lane/direction, vehicle size, occlusion, day/night, and preprocessing profile;
- agreement across multiple observations of the same track;
- track fragmentation and identity-switch rates;
- matched crossing precision, recall, F1, missed crossings, duplicates, wrong direction, and wrong class; and
- total and per-class count error on complete clips.

Use event matching by zone, direction, class, and a documented timestamp tolerance. Report machine-only results separately from operator-corrected results.

Initial production gates—subject to any governing survey standard—should be explicit before evaluation. Recommended targets are:

- at least 90% precision and recall for each released category on the held-out target-camera set;
- no more than 5% direct `NA↔K` confusion;
- at least 98% overall crossing detection on the agreed validation protocol;
- no duplicate physical-vehicle crossing events;
- no material day/night or near/far subgroup hidden by the aggregate score;
- deterministic event totals on repeated runs with the same frozen backend/configuration;
- classifier runtime adding no more than 15% average wall-clock analysis time on the target workstation; and
- an explicit, operationally acceptable uncertain/review rate.

These are release gates, not claims that the current app or a future first model already satisfies an official standard.

**Gate:** a signed benchmark report identifies the exact model/configuration that passed, the clips used, confidence intervals or raw denominators, all exclusions, and all known failure modes.

## 6. Export a governed model artifact

Produce:

- FP32 ONNX reference model;
- quantized browser model if it passes parity checks;
- SHA-256 checksums;
- immutable model ID/version;
- exact label order and input transform;
- training-data manifest references and licenses;
- training code revision and hyperparameters;
- validation report;
- browser/runtime compatibility matrix; and
- a model card with limitations and intended camera domain.

Quantization must pass per-class and end-to-end count parity gates, not merely produce a loadable ONNX file.

## 7. Integrate without corrupting the existing detector contract

Do not rename the current COCO `VehicleClass`. Introduce separate concepts, for example:

- `DetectorClass = car | truck | bus | motorcycle`;
- `VehicleGroup = O | NA | K | M | A | uncertain`;
- classifier model/version and confidence;
- raw and reviewed group values; and
- classification source (`model`, `operator`, or `fallback`).

Integration points include:

- `web/src/types.ts`: separate detector and reporting taxonomies; version event/session schemas;
- `web/src/services/vehicleDetector.ts`: continue returning raw detections and expose padded full-vehicle crops or crop coordinates;
- a new classifier service: queued, asynchronous ONNX classification;
- `web/src/lib/trafficCounter.ts`: retain several best real observations and aggregate classification scores over a confirmed track;
- `web/src/services/videoProcessor.ts`: schedule classification without adding a second full-frame detector pass;
- `web/src/lib/stats.ts`, `palette.ts`, `drawOverlay.ts`, and UI components: render the new reporting taxonomy;
- `web/src/lib/exporters.ts`: export raw class, model group, reviewed group, confidence, classifier version, and uncertainty; and
- tests: schema migration, temporal voting, late classification, uncertainty, mixed old/new sessions, and model/runtime failures.

Freeze the group at count finalization. Keep the machine prediction immutable; operator correction is a separate field and audit event.

**Gate:** old four-class session files remain readable or fail with a clear version error; current counting behavior is unchanged when the classifier feature is disabled.

## 8. Roll out in shadow mode with rollback

1. Ship the classifier disabled by default.
2. In shadow mode, calculate groups and diagnostics without changing official totals.
3. Compare shadow predictions against operator-adjudicated events on complete representative sessions.
4. Promote only the exact model/configuration that passes the frozen gates.
5. Keep a one-control rollback to the current COCO reporting path.
6. Preserve classifier version and feature state in every export.
7. Remove a rejected model artifact rather than accumulating ambiguous “experimental” production modes.

A rollback must never rewrite historical results. Session schema and model IDs determine how an existing result is interpreted.

---

# Production-readiness roadmap

## P0 — establish trustworthy measurement and session integrity

These items block treating output as an authoritative workplace measurement.

### P0.1 Fix run/export integrity defects

Current source review found several concrete defects:

- after a run, controls unlock and the current zones/configuration can change while existing events remain; counts and exports are then recomputed using metadata that may not match the run;
- export buttons are disabled when there are zero events, although a completed zero-traffic session is valid evidence;
- partial/error runs retain accumulated events and can currently be exported without a completion flag, allowing an incomplete count to look final;
- `VideoProcessor.run()` returns on invalid duration before its `try/finally`, leaving its internal `running` state true;
- Stop only sets a flag checked between samples; loading and a hung detector call are not cancellable; and
- the export object URL is revoked immediately after the synthetic click, which should be hardened and browser-tested.

Required changes:

- create an immutable run snapshot when Start is pressed;
- make live edits affect only the next run;
- export from the completed run snapshot, not current UI state;
- allow completed/stopped zero-event summaries and JSON;
- normalize every completion/error path through one finalizer; and
- add cancellable loading, seek, preprocessing, and inference boundaries with explicit timeout/error states.

**Acceptance:** post-run edits cannot change historical totals or metadata; zero-event sessions export correctly; every start reaches exactly one complete/stopped/error final state; repeated start/stop/error cycles do not leak or deadlock.

### P0.2 Create a versioned, immutable session record

Add a schema-versioned session/project format containing:

- run ID and lifecycle status/end reason;
- original filename, byte size, MIME type, duration, resolution, and SHA-256 fingerprint;
- optional camera/site, recording start time/timezone, survey/operator, and notes;
- application build/version and browser/runtime details;
- model ID, source/license reference, model-file checksum, actual backend, dtype, and fallback history;
- exact preprocessing profile and parameters;
- confidence, sampling rate, tracker/counter version and parameters;
- frozen zones, semantic lane/direction labels, and normalized geometry;
- raw machine events, corrections, and final reviewed events;
- warnings, decoder/seek/inference errors, processing timing, and completion status; and
- creation, processing, review, and export timestamps.

JSON is the canonical interchange/audit format. CSV files are derived reports with an export-schema version.

**Acceptance:** two exports from the same completed run have identical analytical content; every reported value can be traced to frozen inputs and versions; incompatible schema versions fail clearly rather than being guessed.

### P0.3 Add evidence-backed review and correction

Add an event timeline/review workspace. Each crossing should retain enough evidence to inspect the decision without rerunning an entire video:

- crossing timestamp and nearby observation timestamps;
- track path and bounding boxes;
- machine class/group and confidence history;
- zone/direction;
- a small, policy-approved evidence crop or reproducible frame reference; and
- quality flags such as coasting, occlusion, edge clipping, or low confidence.

An operator must be able to:

- accept or reject a crossing;
- change its class/group;
- correct direction/zone where appropriate;
- add a missed crossing at a video timestamp;
- attach a reason/note; and
- undo a correction while preserving audit history.

This same workflow should export reviewed track crops for future classifier labeling, avoiding duplicate tooling.

**Acceptance:** machine totals and reviewed totals remain separately reproducible; every correction records old/new values, reason, and time; training exports exclude unreviewed or leakage-prone data by default.

### P0.4 Build the representative-video validation harness

Create a small governed corpus of real videos with manually adjudicated crossing events. The harness must run the actual browser detector, preprocessor, tracker, and counter—not mocked detections only—and compare predicted events to ground truth.

Cover:

- both directions and every zone orientation;
- low, normal, and dense traffic;
- day, dusk, night, wet roads, glare, and compression;
- near/far and small vehicles;
- occlusion, parallel vehicles, stopping/turning near the line, and detector gaps;
- supported target browsers/backends/dtypes; and
- Standard versus Night profiles.

Produce matched-event precision/recall/F1, missed/duplicate/wrong-direction/wrong-class events, clip totals, subgroup results, runtime, and memory. Keep calibration clips separate from final holdout clips.

**Acceptance:** a versioned benchmark report passes predeclared thresholds; each release automatically detects regression against the approved baseline.

### P0.5 Persist progress and recover safely

All current state is in React memory. Add local persistence—preferably IndexedDB for this local-first product—for configuration, immutable run snapshots, progress checkpoints, events, warnings, and review state.

A resumed run should request the original file again if browser permissions do not persist, verify its fingerprint, resume from an overlap before the last checkpoint, and deduplicate events deterministically. Never silently resume with a different file.

**Acceptance:** tab refresh/crash during a long run loses at most the documented checkpoint interval; resume produces the same final event set as an uninterrupted run; storage exhaustion is detected and explained.

### P0.6 Replace development launch with a governed release

`setup-and-run.ps1` currently starts Vite’s development server. Create a versioned production build and a small supported local static-server/desktop packaging path that:

- serves immutable built assets;
- sets COOP/COEP headers required by multithreaded WASM;
- defines CSP, MIME types, cache policy, and other deployment headers;
- supports the chosen root or subpath consistently (`/models/` is currently absolute);
- verifies model/runtime assets and checksums before use;
- pins a supported Node/runtime or removes Node from the operator path;
- produces an SBOM/license inventory; and
- has a documented install, upgrade, rollback, backup, and support procedure.

**Acceptance:** a clean supported workstation installs and runs an exact release without a development server; offline startup, model loading, export, update, and rollback are smoke-tested.

## P1 — make recurring workplace operation efficient and safe

### P1.1 Save camera/site configuration profiles

Persist named, versioned profiles for camera/site metadata, video geometry, zones, line positions, semantic directions (for example northbound/southbound), model, preprocessing, confidence, and sampling. Detect resolution/aspect-ratio mismatch before reusing a profile.

### P1.2 Add batch processing and a job queue

Support multiple local files with queued/running/complete/error/cancelled states, per-job frozen configuration, retry policy, duplicate-input detection, aggregate reporting, and bounded resource use. One corrupt file must not abort the queue.

### P1.3 Produce survey-oriented reports

Add recording start time/timezone and configurable 5/15/60-minute intervals; report by site, lane/zone, semantic direction, class/group, raw versus reviewed status, and quality flags. Keep event CSV, summary CSV, and canonical JSON mutually reconcilable.

### P1.4 Harden ingestion and codec handling

Preflight file readability, metadata, duration, resolution, supported codec, and configurable size/duration limits before model loading. Explain MOV/container versus codec compatibility. Add a documented local transcoding path for unsupported inputs rather than failing mid-run.

### P1.5 Move heavy work off the interactive UI path

Profile first, then move decoding/frame preparation/inference or classification queues to workers where browser APIs permit. Reuse buffers, bound queues, make cancellation real, and prevent UI rendering from dictating analysis throughput. Long-run tests should detect memory growth and thermal throttling.

### P1.6 Add CI and release-quality tests

The current tests cover core pure logic well but omit `VehicleDetector`, `VideoProcessor`, the analysis hook, actual ONNX assets, and browser workflows. Add:

- service integration tests with deterministic doubles;
- actual-model smoke tests on fixed frames;
- real Chromium/Edge end-to-end flows;
- WebGPU and WASM coverage on supported environments;
- codec/error/stop/restart/zero-event/export tests;
- accessibility and keyboard tests, including zone editing alternatives;
- long-video memory/performance tests;
- dependency, license, and model-checksum checks; and
- CI gates for test, lint, build, benchmark, and release artifact verification.

### P1.7 Define privacy, retention, and support policy

Document that ordinary analysis remains local, which metadata/evidence is stored, how long it is retained, who may access it, and how it is deleted/exported. If evidence crops or a backend are introduced, define plate/face/location handling before rollout. Add a diagnostic bundle that excludes raw video by default.

## P2 — optional product expansion after P0/P1

These are not prerequisites for a reliable uploaded-video counter and should only be built for a confirmed operational need:

- live camera, RTSP, or continuously recorded stream ingestion;
- multi-camera/site management and centralized aggregation;
- user accounts, roles, approval workflow, and shared database;
- scheduled analysis, notifications, and health monitoring;
- map/GIS and external traffic-data integrations;
- installable desktop/PWA operation;
- Czech localization and additional languages;
- native Flutter/mobile inference; and
- public API or integration with an existing transport-information system.

A live or centralized system materially changes privacy, security, uptime, storage, and support requirements; it must not be treated as a small frontend feature.

---

# Recommended next work

Do not start with another model or more dashboard widgets. The highest-leverage sequence is:

1. **Session integrity:** fix frozen-run/export correctness, valid zero-event export, lifecycle finalization, and cancellation.
2. **Canonical session schema and persistence:** add provenance, input/model checksums, run configuration snapshots, and crash-safe checkpoints.
3. **Review and evidence workspace:** make every count inspectable/correctable and produce governed labeled tracks for later model work.
4. **Real-video benchmark:** adjudicate representative day/night clips and establish count-level release gates.
5. **Production packaging and CI:** ship an exact offline release with required headers, model verification, browser smoke tests, and rollback.
6. **Operational workflow:** add reusable site profiles, semantic directions, batch jobs, standard interval reports, and codec preflight.
7. **Deferred classifier:** proceed with O/NA/K/M/A only after the license, rubric, data, and baseline validation gates above are satisfied.

This order turns the current counter into a measurable and auditable system first. It also creates the exact reviewed track data needed to train the future classifier, so production hardening and model improvement reinforce each other instead of creating two separate efforts.
