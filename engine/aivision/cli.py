"""Command-line entry point.

    aivision serve                         # web UI on http://127.0.0.1:8000
    aivision count clip.mp4 --zones z.json # headless count + exports
    aivision bench clip.mp4                # throughput per model/device
    aivision info                          # providers, GPU, models
"""

from __future__ import annotations

import argparse
import contextlib
import ipaddress
import json
import logging
import sys
import time
from pathlib import Path

from .models import DEFAULT_MODEL_ID, MODEL_PROFILES, ensure_model
from .schema import AnalysisConfig, CountingZone, Rect


def _display_host(host: str) -> str:
    """Host to show in the printed URL: loopback/unspecified binds are shown as localhost."""
    try:
        address = ipaddress.ip_address(host)
    except ValueError:
        return host
    return "localhost" if address.is_loopback or address.is_unspecified else host


def _default_zone() -> CountingZone:
    return CountingZone(
        id="zone-1",
        label="Zone 1",
        region=Rect(left=0.0, top=0.0, width=1.0, height=1.0),
        line_orientation="horizontal",
        line_offset=0.55,
    )


def _load_zones(path: str | None) -> list[CountingZone]:
    if not path:
        return [_default_zone()]
    try:
        data = json.loads(Path(path).read_text(encoding="utf-8"))
        if isinstance(data, dict):
            data = data.get("zones", [])
        return [CountingZone.model_validate(z) for z in data]
    except (OSError, ValueError) as error:
        raise SystemExit(f"Could not read zones from {path}: {error}") from error


def cmd_info(_: argparse.Namespace) -> int:
    import platform

    print(f"Python      {sys.version.split()[0]} on {platform.system()} {platform.machine()}")
    try:
        import onnxruntime as ort

        if hasattr(ort, "preload_dlls"):
            with contextlib.suppress(Exception):
                ort.preload_dlls()
        print(f"ONNX RT     {ort.__version__}")
        print(f"Providers   {', '.join(ort.get_available_providers())}")
    except ImportError:
        print("ONNX RT     not installed")
    try:
        from av.codec.hwaccel import hwdevices_available

        print(f"HW decode   {', '.join(hwdevices_available()) or 'none'}")
    except Exception:  # noqa: BLE001
        print("HW decode   unavailable")
    print("Models:")
    from .models import model_path

    for profile in MODEL_PROFILES.values():
        present = "downloaded" if model_path(profile).exists() else "not downloaded"
        print(f"  {profile.id:<14} {profile.input_size}px  {present}  - {profile.description}")
    return 0


def cmd_download(args: argparse.Namespace) -> int:
    for model_id in args.models or list(MODEL_PROFILES):
        print(ensure_model(model_id))
    return 0


def cmd_count(args: argparse.Namespace) -> int:
    from .detector import VehicleDetector
    from .export import events_csv, session_json, summarize, summary_csv
    from .pipeline import Pipeline

    config = AnalysisConfig(
        model_id=args.model,
        device=args.device,
        confidence=args.confidence,
        sampling_fps=args.sampling_fps,
        zones=_load_zones(args.zones),
    )
    t0 = time.perf_counter()
    detector = VehicleDetector(config.model_id, config.device)
    load_s = time.perf_counter() - t0
    print(f"Engine: {detector.profile.label} on {detector.info.provider} ({detector.info.precision}), "
          f"loaded in {load_s:.1f}s")

    pipeline = Pipeline(detector, config)
    last_print = [0.0]
    inference_ms: list[float] = []

    def on_frame(result) -> None:
        inference_ms.append(result.timings.inference_ms)
        for e in result.events:
            print(f"  [{e.video_time:7.2f}s] #{e.seq:<4} {e.vehicle_class:<10} {e.direction:<5} "
                  f"zone={e.zone_id} track={e.track_id}")
        now = time.perf_counter()
        if not args.quiet and now - last_print[0] > 2:
            last_print[0] = now
            print(f"  ... {result.progress * 100:5.1f}%  {result.throughput_fps:6.1f} fps  "
                  f"infer {result.timings.inference_ms:5.1f} ms  decode {result.timings.decode_ms:5.1f} ms",
                  flush=True)

    summary = pipeline.run(args.video, on_frame=on_frame)
    counts = summarize(summary.events, config.zones)
    inference_ms.sort()
    median = inference_ms[len(inference_ms) // 2] if inference_ms else 0.0
    perf = {
        "frames": summary.frames,
        "wallSeconds": round(summary.wall_seconds, 2),
        "fps": round(summary.fps, 1),
        "medianInferenceMs": round(median, 2),
        "realtimeFactor": round(summary.video.duration / summary.wall_seconds, 2) if summary.wall_seconds else 0,
        "hwDecode": summary.video.hw_decode,
    }
    print()
    print(f"Video     {summary.video.width}x{summary.video.height} @ {summary.video.fps:.2f} fps, "
          f"{summary.video.duration:.1f}s, codec {summary.video.codec}, hw decode {summary.video.hw_decode}")
    print(f"Analysed  {summary.frames} frames in {summary.wall_seconds:.1f}s  ->  {summary.fps:.1f} fps "
          f"({perf['realtimeFactor']}x real time), median inference {median:.1f} ms")
    print(f"Counted   {counts['total']} vehicles  {counts['byClass']}  {counts['byDirection']}")

    if args.out:
        out = Path(args.out)
        out.mkdir(parents=True, exist_ok=True)
        stem = Path(args.video).stem
        (out / f"{stem}-events.csv").write_text(events_csv(summary.events, config.zones), encoding="utf-8")
        (out / f"{stem}-summary.csv").write_text(
            summary_csv(summary.events, config.zones, config.preprocessing_profile_id), encoding="utf-8"
        )
        session = session_json(
            file_name=Path(args.video).name,
            duration_seconds=summary.video.duration,
            engine=detector.info.to_json(),
            config=config,
            events=summary.events,
            performance=perf,
        )
        (out / f"{stem}-session.json").write_text(json.dumps(session, indent=2), encoding="utf-8")
        print(f"Exports   {out.resolve()}")
    return 0


def cmd_bench(args: argparse.Namespace) -> int:
    from .detector import VehicleDetector
    from .pipeline import Pipeline

    zones = _load_zones(args.zones)
    for model_id in args.models or list(MODEL_PROFILES):
        for device in args.devices:
            try:
                detector = VehicleDetector(model_id, device)
            except Exception as error:  # noqa: BLE001
                print(f"{model_id:<14} {device:<5} FAILED: {error}")
                continue
            config = AnalysisConfig(
                model_id=model_id,
                device=device,
                confidence=args.confidence,
                zones=zones,
                sampling_fps=args.sampling_fps,
            )
            summary = Pipeline(detector, config).run(args.video)
            print(f"{model_id:<14} {detector.info.provider:<9} {summary.frames:>5} frames  "
                  f"{summary.fps:7.1f} fps  {len(summary.events):>4} counts", flush=True)
    return 0


def cmd_serve(args: argparse.Namespace) -> int:
    import uvicorn

    from .server import create_app

    shown_host = _display_host(args.host)
    url = f"http://{shown_host}:{args.port}"
    print(f"AIVision running at {url}")
    if args.open:
        import threading
        import webbrowser

        threading.Timer(1.5, lambda: webbrowser.open(url)).start()
    uvicorn.run(create_app(), host=args.host, port=args.port, log_level="warning")
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="aivision", description="AIVision traffic counter")
    parser.add_argument("-v", "--verbose", action="store_true")
    sub = parser.add_subparsers(dest="command", required=True)

    p = sub.add_parser("serve", help="run the web UI")
    p.add_argument("--host", default="127.0.0.1")
    p.add_argument("--port", type=int, default=8000)
    p.add_argument("--open", action="store_true", help="open the browser")
    p.set_defaults(func=cmd_serve)

    p = sub.add_parser("count", help="count vehicles in a video")
    p.add_argument("video")
    p.add_argument("--zones", help="JSON file with a list of zones (or a session export)")
    p.add_argument("--model", default=DEFAULT_MODEL_ID, choices=list(MODEL_PROFILES))
    p.add_argument("--device", default="auto", choices=["auto", "gpu", "cpu"])
    p.add_argument("--confidence", type=float, default=0.35)
    p.add_argument("--sampling-fps", type=float, default=0.0, help="0 = every frame")
    p.add_argument("--out", help="directory for CSV/JSON exports")
    p.add_argument("-q", "--quiet", action="store_true")
    p.set_defaults(func=cmd_count)

    p = sub.add_parser("bench", help="benchmark models/devices on a video")
    p.add_argument("video")
    p.add_argument("--zones")
    p.add_argument("--models", nargs="*", choices=list(MODEL_PROFILES))
    p.add_argument("--devices", nargs="*", default=["auto"], choices=["auto", "gpu", "cpu"])
    p.add_argument("--sampling-fps", type=float, default=0.0)
    p.add_argument("--confidence", type=float, default=0.35)
    p.set_defaults(func=cmd_bench)

    p = sub.add_parser("download", help="download model weights")
    p.add_argument("models", nargs="*", choices=list(MODEL_PROFILES))
    p.set_defaults(func=cmd_download)

    p = sub.add_parser("info", help="show runtime/provider info")
    p.set_defaults(func=cmd_info)

    args = parser.parse_args(argv)
    logging.basicConfig(level=logging.INFO if args.verbose else logging.WARNING, format="%(levelname)s %(message)s")
    return args.func(args)


if __name__ == "__main__":
    raise SystemExit(main())
