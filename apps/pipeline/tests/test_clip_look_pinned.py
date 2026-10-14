"""The rendered clip's look with no settings changed, pinned before the look became settings.

The expected text below was produced by ``lib/clipper.py`` while the caption
rules and the zoom were still constants in code. A render with an empty
``settings`` must keep producing exactly this caption file and ffmpeg command.
"""
import unittest
from pathlib import Path
from unittest import mock

from lib import clipper


def timed(start, text, per_word=0.3, gap=0.05):
    """A Parakeet-style segment: every word carries its own start and end."""
    words, t = [], start
    for token in text.split():
        words.append({"start": round(t, 2), "end": round(t + per_word, 2), "text": token})
        t += per_word + gap
    return {"start": start, "end": round(t - gap, 2), "text": text, "words": words}


SEGMENTS = [
    timed(100.0, "So I watched Mimic dubbed in Spanish, and I did not notice."),
    timed(104.6, "Momma wants wombat memorabilia more than William wants warm milk"),
    # A pause of more than half a second, then a word Parakeet stretched over music.
    {"start": 111.0, "end": 119.0, "text": "Wait. What?", "words": [
        {"start": 111.0, "end": 111.4, "text": "Wait."},
        {"start": 112.2, "end": 118.9, "text": "What?"},
    ]},
    # Whisper-style: no word timings, so they are spread over the segment.
    {"start": 119.5, "end": 126.0, "text": "It's called The Thomas Crown Affair, not the {Thomas} Crown bank job!"},
    {"start": 126.1, "end": 127.0, "text": "Okay."},
]
WINDOW = (101.0, 126.5)

PINNED_CAPTIONS = """[Script Info]
ScriptType: v4.00+
PlayResX: 1080
PlayResY: 1920
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name,Fontname,Fontsize,PrimaryColour,SecondaryColour,OutlineColour,BackColour,Bold,Italic,Underline,StrikeOut,ScaleX,ScaleY,Spacing,Angle,BorderStyle,Outline,Shadow,Alignment,MarginL,MarginR,MarginV,Encoding
Style: Caption,Arial Bold,84,&H0000FFFF,&H0000FFFF,&H00000000,&H64000000,-1,0,0,0,100,100,0,0,1,4,0,2,80,80,220,1

[Events]
Format: Layer,Start,End,Style,Name,MarginL,MarginR,MarginV,Effect,Text

Dialogue: 0,0:00:00.05,0:00:02.15,Caption,,0,0,0,,MIMIC DUBBED IN SPANISH, AND I
Dialogue: 0,0:00:02.15,0:00:03.15,Caption,,0,0,0,,DID NOT NOTICE.
Dialogue: 0,0:00:03.60,0:00:05.00,Caption,,0,0,0,,MOMMA WANTS WOMBAT MEMORABILIA
Dialogue: 0,0:00:05.00,0:00:06.75,Caption,,0,0,0,,MORE THAN WILLIAM WANTS WARM
Dialogue: 0,0:00:06.75,0:00:07.05,Caption,,0,0,0,,MILK
Dialogue: 0,0:00:10.00,0:00:10.40,Caption,,0,0,0,,WAIT.
Dialogue: 0,0:00:11.20,0:00:12.70,Caption,,0,0,0,,WHAT?
Dialogue: 0,0:00:18.50,0:00:21.19,Caption,,0,0,0,,IT'S CALLED THE THOMAS CROWN
Dialogue: 0,0:00:21.19,0:00:24.07,Caption,,0,0,0,,AFFAIR, NOT THE \\{THOMAS\\} CROWN
Dialogue: 0,0:00:24.07,0:00:25.10,Caption,,0,0,0,,BANK JOB!
Dialogue: 0,0:00:25.10,0:00:25.50,Caption,,0,0,0,,OKAY."""

ZOOM = "scale=4320:7680:flags=lanczos,zoompan=z='1+0.12*on/{last}':x='(iw-iw/zoom)/2':y='(ih-ih/zoom)/2':d={frames}:s=1080x1920:fps=30"
PINNED_COMMAND = [
    "ffmpeg", "-y", "-loop", "1", "-i", "/v/bg.png", "-ss", "101.0", "-t", "25.5", "-i", "/e/ep.mp3",
    "-vf", ZOOM.format(last=764, frames=765) + ",subtitles=/v/c.ass",
    "-r", "30", "-af", "afade=t=out:st=24.700:d=0.800",
    "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", "/c/out.mp4",
]


class PinnedClipLookTests(unittest.TestCase):
    def test_captions_with_no_settings_changed(self):
        if clipper._caption_font() is None:
            self.skipTest("caption font not installed; line fitting falls back to character counts")
        self.assertEqual(clipper._build_ass_subtitles(SEGMENTS, *WINDOW), PINNED_CAPTIONS)

    def test_zoom_filter_with_no_settings_changed(self):
        self.assertEqual(clipper._build_zoompan_filter(18.0, Path("/tmp/x.ass")),
                         ZOOM.format(last=539, frames=540) + ",subtitles=/tmp/x.ass")
        self.assertEqual(clipper._build_zoompan_filter(83.2, None), ZOOM.format(last=2495, frames=2496))
        self.assertEqual(clipper._build_zoompan_filter(0.01, Path("/data dir/it's: a clip.ass")),
                         ZOOM.format(last=1, frames=1) + ",subtitles=/data dir/it\\'s\\: a clip.ass")

    def test_ffmpeg_command_with_no_settings_changed(self):
        with mock.patch.object(clipper.subprocess, "run") as run:
            clipper._render_clip_video(Path("/v/bg.png"), Path("/v/c.ass"), "/e/ep.mp3", Path("/c/out.mp4"),
                                       101.0, 126.5, True)
        self.assertEqual(run.call_args.args[0], PINNED_COMMAND)


if __name__ == "__main__":
    unittest.main()
