"""Laughter detector – scans audio for laughter-like events."""
from __future__ import annotations

import logging
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any, Dict, List

import numpy as np


LAUGHTER_IMAGE_PROMPT = (
    "An abstract burst of joyful energy expressed through rippling color, bouncing geometric "
    "forms, warm light, and playful motion in a surreal cinematic environment. No people, "
    "podcasters, recording studio, microphones, headphones, text, logos, or watermarks; "
    "vertical 9:16 composition with clean space for subtitles added in post."
)

logger = logging.getLogger(__name__)

# Laughter characteristics (tunable)
LAUGHTER_FMIN = 200       # Hz – speech fundamental usually below this
LAUGHTER_FMAX = 1000      # Hz – laughter energy concentrates here
LAUGHTER_ONSET_RATE_MIN = 3.0   # onsets/sec for a laugh burst
LAUGHTER_ONSET_RATE_MAX = 10.0
LAUGHTER_WINDOW_SEC = 2.0  # sliding window for onset counting
MIN_LAUGH_DURATION = 1.0   # minimum continuous laugh segment
MAX_LAUGH_DURATION = 8.0   # cap to avoid merging long segments into one


@dataclass
class LaughterDetectionParams:
    """Heuristic thresholds for laugh detection."""

    laughter_fmin: float = LAUGHTER_FMIN
    laughter_fmax: float = LAUGHTER_FMAX
    onset_rate_min: float = LAUGHTER_ONSET_RATE_MIN
    onset_rate_max: float = LAUGHTER_ONSET_RATE_MAX
    window_sec: float = LAUGHTER_WINDOW_SEC
    rms_multiplier: float = 1.2
    laugh_ratio_min: float = 0.25
    centroid_multiplier: float = 1.0
    merge_gap_sec: float = 2.0

    @classmethod
    def from_overrides(cls, overrides: Dict[str, Any] | None) -> "LaughterDetectionParams":
        if not overrides:
            return cls()
        valid = {k: v for k, v in overrides.items() if k in cls.__dataclass_fields__}
        return cls(**valid)


def _detect_onset_times(y: np.ndarray, sr: int, hop_length: int) -> np.ndarray:
    """Return onset locations in seconds, matching the detector's window clock."""
    import librosa

    return librosa.onset.onset_detect(
        y=y,
        sr=sr,
        hop_length=hop_length,
        backtrack=True,
        units="time",
    )


def detect_laughter(
    audio_path: str | Path,
    *,
    sr: int = 16000,    # downsample for speed
    clip_duration: int = 30,  # seconds of clip centered on laugh
    max_detections: int = 20,
    hop_length: int = 512,
    params: Dict[str, Any] | None = None,
    collect_diagnostics: bool = False,
) -> List[Dict[str, Any]]:
    """Detect laughter-like events in audio.
    
    Strategy:
    1. Compute onset strength (how often energy spikes)
    2. Compute spectral centroid (laugh = higher pitch than speech)
    3. Scan in sliding windows for regions with:
       - Onset rate in [LAUGHTER_ONSET_RATE_MIN, LAUGHTER_ONSET_RATE_MAX] 
       - Spectral centroid above median (energetic/higher pitch)
    4. Merge nearby detections and return clip windows around each.
    
    Returns a list of clip dicts with start, end, headline, why fields.
    """
    try:
        import librosa
    except ImportError as exc:
        logger.error("librosa not installed: %s", exc)
        return []

    audio_path = Path(audio_path)
    if not audio_path.is_file():
        logger.error("Audio file not found: %s", audio_path)
        return []

    logger.info("Loading audio for laughter detection: %s", audio_path.name)
    y, sr_actual = librosa.load(audio_path, sr=sr, mono=True, duration=None)
    logger.info("Loaded %.1fs of audio at %d Hz", len(y) / sr, sr)

    diagnostics: List[Dict[str, Any]] = []
    active_params = LaughterDetectionParams.from_overrides(params)
    fallback_passes = [
        active_params,
        LaughterDetectionParams(**{**asdict(active_params), "onset_rate_min": max(1.0, active_params.onset_rate_min - 1.0), "rms_multiplier": max(1.0, active_params.rms_multiplier - 0.1), "laugh_ratio_min": max(0.15, active_params.laugh_ratio_min - 0.07)}),
        LaughterDetectionParams(**{**asdict(active_params), "onset_rate_min": max(0.5, active_params.onset_rate_min - 1.8), "onset_rate_max": active_params.onset_rate_max + 2.0, "rms_multiplier": max(0.95, active_params.rms_multiplier - 0.2), "laugh_ratio_min": max(0.10, active_params.laugh_ratio_min - 0.12), "centroid_multiplier": max(0.9, active_params.centroid_multiplier - 0.1)}),
    ]

    merged: List[Dict[str, Any]] = []
    centroid_med = 0.0
    rms_med = 0.0
    for pass_idx, pass_params in enumerate(fallback_passes):
        merged, pass_diag = _run_detection_pass(
            y=y,
            sr=sr,
            hop_length=hop_length,
            params=pass_params,
            max_detections=max_detections,
        )
        centroid_med = pass_diag["centroid_med"]
        rms_med = pass_diag["rms_med"]
        diagnostics.append(
            {
                "pass": pass_idx,
                "mode": "base" if pass_idx == 0 else "fallback",
                "detections": len(merged),
                "params": asdict(pass_params),
            }
        )
        if merged:
            break

    if not merged:
        logger.info("No laughter-like events detected")
        return []

    # Convert to clip format
    duration_total = len(y) / sr
    clips = []
    for i, cand in enumerate(merged):
        start, end = _center_clip_bounds(
            anchor=cand.get("peak_center", cand["center"]),
            clip_duration=max(float(clip_duration), 20.0),
            duration_total=duration_total,
        )
        clips.append({
            "start": round(start, 2),
            "end": round(end, 2),
            "headline": f"Laughter moment around {cand.get('peak_center', cand['center'])/60:.0f}m",
            "imagePrompt": LAUGHTER_IMAGE_PROMPT,
            "why": f"Audio-laughter detected (score {cand['score']:.2f}): onset rate {cand['onset_rate']:.1f}/s, "
                   f"centroid {cand['centroid']/centroid_med:.1f}× median, laugh-band ratio {cand['laugh_ratio']:.2f}",
            "source": "laughter_audio",
        })
    
    logger.info("Detected %d laughter moments from %d candidates", len(clips), len(merged))
    if collect_diagnostics and clips:
        for clip in clips:
            clip["_laughterDiagnostics"] = diagnostics
    return clips


def _run_detection_pass(
    *,
    y: np.ndarray,
    sr: int,
    hop_length: int,
    params: LaughterDetectionParams,
    max_detections: int,
) -> tuple[List[Dict[str, Any]], Dict[str, float]]:
    """Run one laughter-detection pass with a single parameter set."""
    import librosa

    onset_env = librosa.onset.onset_strength(y=y, sr=sr, hop_length=hop_length)
    onset_frames = librosa.frames_to_time(
        np.arange(len(onset_env)), sr=sr, hop_length=hop_length
    )
    onset_times = _detect_onset_times(y=y, sr=sr, hop_length=hop_length)
    centroid = librosa.feature.spectral_centroid(
        y=y, sr=sr, hop_length=hop_length
    )[0]
    centroid_med = float(np.median(centroid))
    rms = librosa.feature.rms(y=y, hop_length=hop_length)[0]
    rms_med = float(np.median(rms))

    S = np.abs(librosa.stft(y, hop_length=hop_length))
    freqs = librosa.fft_frequencies(sr=sr)
    laugh_band_mask = (freqs >= params.laughter_fmin) & (freqs <= params.laughter_fmax)
    speech_band_mask = (freqs < params.laughter_fmin) | (freqs > params.laughter_fmax)
    laugh_energy = np.sum(S[laugh_band_mask], axis=0)
    speech_energy = np.sum(S[speech_band_mask], axis=0)
    total_energy = laugh_energy + speech_energy + 1e-10
    laugh_ratio = laugh_energy / total_energy

    window_frames = int(params.window_sec * sr / hop_length)
    step = max(1, window_frames // 2)
    laugh_candidates = []

    for i in range(0, max(1, len(onset_env) - window_frames), step):
        window_ends = min(i + window_frames, len(onset_env))
        if window_ends <= i:
            continue
        window_onsets = sum(
            1 for t in onset_times if onset_frames[i] <= t < onset_frames[window_ends - 1]
        )
        window_duration_sec = (window_ends - i) * hop_length / sr
        onset_rate = window_onsets / max(window_duration_sec, 0.01)
        avg_centroid = float(np.mean(centroid[i:window_ends]))
        avg_rms = float(np.mean(rms[i:window_ends]))
        avg_laugh_ratio = float(np.mean(laugh_ratio[i:window_ends]))
        is_laugh = (
            params.onset_rate_min <= onset_rate <= params.onset_rate_max
            and avg_centroid > centroid_med * params.centroid_multiplier
            and avg_rms > rms_med * params.rms_multiplier
            and avg_laugh_ratio > params.laugh_ratio_min
        )
        if is_laugh:
            center_idx = min(i + max(1, window_frames // 2), len(onset_frames) - 1)
            laugh_candidates.append(
                {
                    "center": onset_frames[center_idx],
                    "onset_rate": onset_rate,
                    "centroid": avg_centroid,
                    "rms": avg_rms,
                    "laugh_ratio": avg_laugh_ratio,
                }
            )

    if not laugh_candidates:
        return [], {"centroid_med": centroid_med, "rms_med": rms_med}

    merged = _merge_candidates(laugh_candidates, gap_sec=params.merge_gap_sec)
    for cand in merged:
        cand["score"] = (
            min(cand["onset_rate"] / max(params.onset_rate_max, 0.01), 1.0) * 0.3
            + min(cand["centroid"] / max(centroid_med * 2, 1e-6), 1.0) * 0.2
            + min(cand["rms"] / max(rms_med * 3, 1e-6), 1.0) * 0.2
            + min(cand["laugh_ratio"], 1.0) * 0.3
        )
    merged.sort(key=lambda x: x["score"], reverse=True)
    return merged[:max_detections], {"centroid_med": centroid_med, "rms_med": rms_med}


def _center_clip_bounds(anchor: float, clip_duration: float, duration_total: float) -> tuple[float, float]:
    """Return a fixed-duration clip centered on anchor, clamped to episode bounds."""
    clip_duration = max(float(clip_duration), 0.0)
    duration_total = max(float(duration_total), 0.0)
    if clip_duration >= duration_total:
        return 0.0, duration_total
    half = clip_duration / 2.0
    start = max(0.0, float(anchor) - half)
    end = min(duration_total, start + clip_duration)
    start = max(0.0, end - clip_duration)
    return start, end


def _merge_candidates(candidates: List[Dict], gap_sec: float = 2.0) -> List[Dict]:
    """Merge nearby detections that likely belong to the same laugh burst."""
    if not candidates:
        return []

    sorted_cands = sorted(candidates, key=lambda x: x["center"])
    first = sorted_cands[0].copy()
    first["burst_start"] = first["center"]
    first["burst_end"] = first["center"]
    first["peak_center"] = first["center"]
    first["peak_strength"] = _candidate_merge_strength(first)
    merged = [first]

    for cand in sorted_cands[1:]:
        last = merged[-1]
        cand_center = float(cand["center"])
        if cand_center - float(last["burst_end"]) < gap_sec:
            # Merge metrics, but keep the strongest local center as the clip anchor.
            last["center"] = (float(last["burst_start"]) + cand_center) / 2
            last["burst_end"] = cand_center
            last["onset_rate"] = (last["onset_rate"] + cand["onset_rate"]) / 2
            last["centroid"] = (last["centroid"] + cand["centroid"]) / 2
            last["rms"] = (last["rms"] + cand["rms"]) / 2
            last["laugh_ratio"] = (last["laugh_ratio"] + cand["laugh_ratio"]) / 2
            cand_strength = _candidate_merge_strength(cand)
            if cand_strength > float(last.get("peak_strength", -1.0)):
                last["peak_strength"] = cand_strength
                last["peak_center"] = cand_center
        else:
            merged_cand = cand.copy()
            merged_cand["burst_start"] = cand_center
            merged_cand["burst_end"] = cand_center
            merged_cand["peak_center"] = cand_center
            merged_cand["peak_strength"] = _candidate_merge_strength(cand)
            merged.append(merged_cand)

    return merged


def _candidate_merge_strength(candidate: Dict[str, float]) -> float:
    """Rank nearby laugh windows so merged bursts anchor on the strongest local beat."""
    return (
        float(candidate.get("onset_rate", 0.0))
        + float(candidate.get("rms", 0.0))
        + float(candidate.get("laugh_ratio", 0.0))
    )
