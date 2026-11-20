"""Bounded real source-image input, independent from native text extraction."""

import base64, io, hashlib
from PIL import Image
from fastapi import HTTPException


def prepare_image(encoded, region=None):
    try:
        data = base64.b64decode(encoded, validate=True)
        if len(data) > 6_000_000:
            raise ValueError("Image size")
        im = Image.open(io.BytesIO(data))
        if im.format not in ("PNG", "JPEG") or im.width * im.height > 12_000_000:
            raise ValueError("Image dimensions")
        im.load()
        im = im.convert("RGB")
        if region:
            x, y, w, h = (region[k] for k in ("x", "y", "width", "height"))
            if not (
                0 <= x < 1
                and 0 <= y < 1
                and 0.01 <= w <= 1
                and 0.01 <= h <= 1
                and x + w <= 1.001
                and y + h <= 1.001
            ):
                raise ValueError("Region bounds")
            im = im.crop(
                (
                    int(x * im.width),
                    int(y * im.height),
                    min(im.width, int((x + w) * im.width)),
                    min(im.height, int((y + h) * im.height)),
                )
            )
        im.thumbnail((1280, 1280))
        output = io.BytesIO()
        im.save(output, format="PNG")
        return "data:image/png;base64," + base64.b64encode(
            output.getvalue()
        ).decode(), {
            "sha256": hashlib.sha256(data).hexdigest(),
            "width": im.width,
            "height": im.height,
            "region": region,
        }
    except (ValueError, KeyError, TypeError, OSError) as exc:
        raise HTTPException(422, "Invalid source image or region") from exc
