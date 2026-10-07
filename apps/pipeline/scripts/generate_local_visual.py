from __future__ import annotations

import argparse
import sys
from pathlib import Path

from PIL import Image, ImageDraw


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Generate a local still image for BBPC clips.")
    parser.add_argument("--prompt", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--model", default="stabilityai/sdxl-turbo")
    parser.add_argument("--width", type=int, default=1080)
    parser.add_argument("--height", type=int, default=1920)
    parser.add_argument("--steps", type=int, default=8)
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument(
        "--allow-placeholder",
        action="store_true",
        help="If torch/diffusers are missing, write the placeholder PNG instead of failing (CI/dry plumbing).",
    )
    return parser.parse_args()


def write_placeholder_image(output_path: Path, prompt: str, width: int, height: int) -> None:
    image = Image.new("RGB", (width, height), color=(18, 18, 24))
    draw = ImageDraw.Draw(image)
    preview = prompt[:220]
    draw.rectangle([(40, 40), (width - 40, height - 40)], outline=(255, 204, 0), width=6)
    draw.multiline_text((70, 120), f"LOCAL VISUAL PLACEHOLDER\n\n{preview}", fill=(255, 232, 160), spacing=16)
    image.save(output_path)


def main() -> None:
    args = parse_args()
    output_path = Path(args.output).expanduser().resolve()
    output_path.parent.mkdir(parents=True, exist_ok=True)

    if args.dry_run:
        write_placeholder_image(output_path, args.prompt, args.width, args.height)
        return

    try:
        import torch
        from diffusers import AutoPipelineForText2Image
    except ImportError as exc:
        print(
            "generate_local_visual: torch/diffusers could not be imported. "
            "Install project deps and run with the same Python as the pipeline (e.g. `source venv/bin/activate`). "
            f"({exc})",
            file=sys.stderr,
        )
        if args.allow_placeholder:
            write_placeholder_image(output_path, args.prompt, args.width, args.height)
            return
        sys.exit(2)

    if torch.cuda.is_available():
        device = torch.device("cuda")
    elif getattr(torch.backends, "mps", None) is not None and torch.backends.mps.is_available():
        device = torch.device("mps")
    else:
        device = torch.device("cpu")
    dtype = torch.float16 if device.type == "cuda" else torch.float32
    try:
        pipe = AutoPipelineForText2Image.from_pretrained(args.model, torch_dtype=dtype)
        pipe = pipe.to(device)
        gen_device = device if device.type != "mps" else torch.device("cpu")
        generator = torch.Generator(device=gen_device).manual_seed(args.seed)
        image = pipe(
            args.prompt,
            width=args.width,
            height=args.height,
            num_inference_steps=args.steps,
            guidance_scale=5.0,
            generator=generator,
        ).images[0]
        image.save(output_path)
    except Exception as exc:
        print(f"generate_local_visual: inference failed ({exc})", file=sys.stderr)
        raise


if __name__ == "__main__":
    main()
