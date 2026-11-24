"""Detector model registry and on-demand download.

Models are the Apache-2.0 RF-DETR COCO checkpoints exported to ONNX by the
onnx-community organisation on Hugging Face. They are downloaded once into
the local models directory and never fetched again.
"""

from __future__ import annotations

import http.client
import os
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import urljoin, urlsplit

HF_BASE = "https://huggingface.co"


@dataclass(frozen=True, slots=True)
class ModelProfile:
    id: str
    label: str
    description: str
    repo: str
    input_size: int
    filename: str = "onnx/model.onnx"

    @property
    def url(self) -> str:
        return f"{HF_BASE}/{self.repo}/resolve/main/{self.filename}"


MODEL_PROFILES: dict[str, ModelProfile] = {
    p.id: p
    for p in (
        ModelProfile(
            id="rfdetr-nano",
            label="RF-DETR Nano",
            description="Fastest. Good for close, well-lit cameras or weak hardware.",
            repo="onnx-community/rfdetr_nano-ONNX",
            input_size=384,
        ),
        ModelProfile(
            id="rfdetr-small",
            label="RF-DETR Small",
            description="Balanced default. Clearly better than YOLOv10-N on small and distant vehicles.",
            repo="onnx-community/rfdetr_small-ONNX",
            input_size=512,
        ),
        ModelProfile(
            id="rfdetr-medium",
            label="RF-DETR Medium",
            description="Most accurate. Best for wide scenes and far lanes; needs a GPU.",
            repo="onnx-community/rfdetr_medium-ONNX",
            input_size=576,
        ),
    )
}

DEFAULT_MODEL_ID = "rfdetr-small"


def models_dir() -> Path:
    root = os.environ.get("AIVISION_MODELS_DIR")
    path = Path(root) if root else Path(__file__).resolve().parent.parent / "models"
    path.mkdir(parents=True, exist_ok=True)
    return path


def get_profile(model_id: str) -> ModelProfile:
    try:
        return MODEL_PROFILES[model_id]
    except KeyError:
        known = ", ".join(MODEL_PROFILES)
        raise ValueError(f"Unknown model '{model_id}'. Known models: {known}") from None


def model_path(profile: ModelProfile) -> Path:
    return models_dir() / f"{profile.id}.onnx"


def ensure_model(model_id: str, progress: bool = True) -> Path:
    """Returns the local ONNX path, downloading it first if needed."""
    profile = get_profile(model_id)
    target = model_path(profile)
    if target.exists() and target.stat().st_size > 0:
        return target

    partial = target.with_suffix(".onnx.part")
    if progress:
        print(f"Downloading {profile.label} from {profile.url} ...", flush=True)
    try:
        with partial.open("wb") as out:
            _https_download(profile.url, out, progress)
        partial.replace(target)
    except (OSError, ValueError, http.client.HTTPException) as error:
        partial.unlink(missing_ok=True)
        raise RuntimeError(f"Could not download model '{model_id}': {error}") from error
    return target


def _https_download(url: str, out, progress: bool, max_redirects: int = 5) -> None:
    """Streams an HTTPS URL to `out`. Only https:// is accepted, including redirects."""
    for _ in range(max_redirects + 1):
        parts = urlsplit(url)
        if parts.scheme != "https" or not parts.hostname:
            raise ValueError(f"Refusing non-HTTPS model URL: {url}")
        conn = http.client.HTTPSConnection(parts.hostname, parts.port or 443, timeout=60)
        try:
            path = parts.path + (f"?{parts.query}" if parts.query else "")
            conn.request("GET", path or "/", headers={"User-Agent": "aivision"})
            response = conn.getresponse()
            if response.status in (301, 302, 303, 307, 308):
                location = response.getheader("Location")
                if not location:
                    raise ValueError("Redirect without Location header")
                url = urljoin(url, location)
                continue
            if response.status != 200:
                raise ValueError(f"HTTP {response.status} {response.reason}")

            total = int(response.getheader("Content-Length") or 0)
            done = 0
            last_pct = -10
            while chunk := response.read(1 << 20):
                out.write(chunk)
                done += len(chunk)
                if progress and total:
                    pct = done * 100 // total
                    if pct >= last_pct + 10:
                        print(f"  {pct}% ({done >> 20} / {total >> 20} MB)", flush=True)
                        last_pct = pct
            return
        finally:
            conn.close()
    raise ValueError("Too many redirects")
