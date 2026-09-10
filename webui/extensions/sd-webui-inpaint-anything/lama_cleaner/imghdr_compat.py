"""Minimal stand-in for the stdlib ``imghdr`` module.

``imghdr`` was removed from the standard library in Python 3.13 (PEP 594), which
made ``lama_cleaner`` - and with it the whole Inpaint Anything extension - fail
to import. Only ``what()`` is used here, and Pillow already ships with the WebUI,
so the detection is delegated to it.
"""

import io

__all__ = ["what"]

# Pillow format name -> the name the stdlib imghdr used to return.
_ALIASES = {
    "jpeg": "jpeg",
    "mpo": "jpeg",
    "tiff": "tiff",
    "webp": "webp",
    "png": "png",
    "gif": "gif",
    "bmp": "bmp",
    "ppm": "ppm",
    "pbm": "pbm",
    "pgm": "pgm",
    "xbm": "xbm",
}


def what(file, h=None):
    """Return the image type of ``file``, or ``None`` when it is not an image.

    ``h``, when given, is the image data itself and ``file`` is ignored - the
    same contract the stdlib version had.
    """
    from PIL import Image

    if h is not None:
        source = io.BytesIO(h if isinstance(h, bytes) else bytes(h))
    else:
        source = file

    try:
        with Image.open(source) as image:
            image_format = image.format
    except Exception:
        return None

    if not image_format:
        return None

    image_format = image_format.lower()
    return _ALIASES.get(image_format, image_format)
