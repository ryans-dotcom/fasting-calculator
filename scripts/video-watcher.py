#!/usr/bin/env python3
"""Video watcher: "watch" a YouTube video without downloading the video stream.

It gathers what a viewer would take in:
  * ears  - the caption track, cleaned into a timestamped transcript
  * eyes  - YouTube's storyboard sprites, sliced into individual frames
  * map   - chapter markers, with the frames and narration for each chapter

Output (in --out, default ./watch-<id>):
  info.json            title, channel, duration, description, chapters
  transcript.txt       [mm:ss] caption lines
  frames/fNNNN.jpg     one frame per storyboard tile (~every 5s)
  chapters/NN.jpg      a contact sheet of the frames in each chapter
  watch-report.md      chapter-by-chapter narration + frame references

Requires: yt-dlp (pip install yt-dlp) and ffmpeg.
Uses the embedded-player client, which works where the default web client
is bot-blocked (e.g. cloud containers).

Usage: python3 scripts/video-watcher.py <youtube-url> [--out DIR]
"""
import argparse
import json
import math
import re
import subprocess
import sys
import urllib.request
from pathlib import Path

YTDLP_ARGS = ["--extractor-args", "youtube:player_client=web_embedded", "--ignore-no-formats-error"]


def run(cmd, check=True):
    return subprocess.run(cmd, check=check, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


def fetch_metadata(url, out):
    run(["yt-dlp", *YTDLP_ARGS, "--skip-download", "--write-info-json", "-o", str(out / "raw"), url])
    return json.loads((out / "raw.info.json").read_text())


def fetch_captions(url, out):
    """Try the original-language track, then the English one; YouTube rate-limits caption requests."""
    for lang in ("en-orig", "en"):
        run(["yt-dlp", *YTDLP_ARGS, "--skip-download", "--write-auto-subs", "--write-subs",
             "--sub-langs", lang, "--sub-format", "vtt", "-o", str(out / "raw"), url], check=False)
        vtt = out / f"raw.{lang}.vtt"
        if vtt.exists():
            return vtt
    return None


def clean_vtt(path):
    """Collapse YouTube's rolling auto-captions into unique timestamped lines."""
    lines, ts, prev = [], None, None
    for raw in path.read_text().splitlines():
        m = re.match(r"(\d+):(\d+):(\d+)\.\d+ -->", raw)
        if m:
            h, mi, s = map(int, m.groups())
            ts = h * 3600 + mi * 60 + s
            continue
        text = re.sub(r"<[^>]+>", "", raw).strip()
        if not text or text == prev or text.startswith(("WEBVTT", "Kind:", "Language:")):
            continue
        if lines and text.startswith(lines[-1][1]):
            lines[-1] = (lines[-1][0], text)
        elif not any(text == t for _, t in lines[-3:]):
            lines.append((ts, text))
        prev = text
    return lines


def fetch_frames(info, out):
    """Download the highest-res storyboard and slice each sprite sheet into frames."""
    boards = [f for f in info.get("formats", []) if f.get("format_id", "").startswith("sb")]
    if not boards:
        return []
    sb = max(boards, key=lambda f: f.get("width") or 0)
    rows, cols = sb["rows"], sb["columns"]
    w, h = sb["width"], sb["height"]
    frames_dir = out / "frames"
    frames_dir.mkdir(exist_ok=True)
    total = math.ceil(info["duration"] / (sb["fragments"][0]["duration"] / (rows * cols)))
    step = info["duration"] / total
    frames, n = [], 0
    for i, frag in enumerate(sb["fragments"]):
        sheet = out / f"sheet{i}.jpg"
        urllib.request.urlretrieve(frag["url"], sheet)
        for r in range(rows):
            for c in range(cols):
                if n >= total:
                    break
                dest = frames_dir / f"f{n:04d}.jpg"
                run(["ffmpeg", "-y", "-loglevel", "error", "-i", str(sheet),
                     "-vf", f"crop={w}:{h}:{c * w}:{r * h}", str(dest)])
                frames.append((round(n * step, 1), dest))
                n += 1
        sheet.unlink()
    return frames


def contact_sheet(paths, dest, cols=6):
    if not paths:
        return
    listing = dest.with_suffix(".txt")
    listing.write_text("".join(f"file '{p.resolve()}'\n" for p in paths))
    rows = math.ceil(len(paths) / cols)
    run(["ffmpeg", "-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", str(listing),
         "-vf", f"scale=320:-1,tile={cols}x{rows}:padding=4", "-frames:v", "1", str(dest)])
    listing.unlink()


def mmss(t):
    return f"{int(t) // 60:02d}:{int(t) % 60:02d}"


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("url")
    ap.add_argument("--out")
    args = ap.parse_args()

    out = Path(args.out or "watch")
    out.mkdir(parents=True, exist_ok=True)
    print("Fetching metadata + captions...", file=sys.stderr)
    info = fetch_metadata(args.url, out)
    duration = info["duration"]
    chapters = info.get("chapters") or [{"start_time": 0, "end_time": duration, "title": "Full video"}]

    vtt = fetch_captions(args.url, out)
    if not vtt:
        print("Warning: no captions available; report will have frames only.", file=sys.stderr)
    transcript = clean_vtt(vtt) if vtt else []
    (out / "transcript.txt").write_text("\n".join(f"[{mmss(t)}] {s}" for t, s in transcript))

    print("Fetching storyboard frames...", file=sys.stderr)
    frames = fetch_frames(info, out)

    (out / "chapters").mkdir(exist_ok=True)
    report = [f"# {info['title']}", "",
              f"**Channel:** {info.get('channel')}  ", f"**Duration:** {mmss(duration)}  ",
              f"**URL:** {info.get('webpage_url', args.url)}", "",
              "## Description", "", info.get("description", ""), ""]
    for i, ch in enumerate(chapters):
        start, end = ch["start_time"], ch["end_time"]
        ch_frames = [p for t, p in frames if start <= t < end]
        sheet = out / "chapters" / f"{i:02d}.jpg"
        contact_sheet(ch_frames, sheet)
        speech = " ".join(s for t, s in transcript if start <= t < end)
        report += [f"## {mmss(start)}-{mmss(end)}  {ch['title']}", "",
                   f"![frames](chapters/{sheet.name})" if ch_frames else "_no frames_", "",
                   speech, ""]
    (out / "watch-report.md").write_text("\n".join(report))
    json.dump({k: info.get(k) for k in ("id", "title", "channel", "duration", "description", "chapters")},
              open(out / "info.json", "w"), indent=2)
    for f in out.glob("raw.*"):
        f.unlink()
    print(f"Done: {len(transcript)} caption lines, {len(frames)} frames, "
          f"{len(chapters)} chapters -> {out}/watch-report.md", file=sys.stderr)


if __name__ == "__main__":
    main()
