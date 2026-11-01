# K-NOT original presentation renderer

This is our small Docker build recipe, not vendored LibreOffice source.
It converts an original presentation to PDF without network access at runtime.
Poppler in the existing Windows environment renders physical PDF pages to PNG.

```powershell
docker build -t knot-office-renderer:local-v1 -f tools/office-renderer/Dockerfile tools/office-renderer
```

The base image is pinned by digest. Debian security repositories supply Office
and fonts at build time; their versions are not permanently frozen. The tested
local image used LibreOffice4:25.2.3-2+deb13u8, image ID
`sha256:d482f93d5e42abbf0feb9a492412124220073a8237f4be9f6ef9f787658a5a8b`,
180012018bytes. Use the app's renderer wrapper, which restricts CPU, memory,
process count, capabilities, network and mounts to its own random job directory.
Do not mount the whole repository, user profile or Docker socket into this image.

## Third-party notices

[LibreOffice licenses](https://www.libreoffice.org/licenses/) describe its
MPL2/LGPL3+ licensing. Debian package copyright notices and installed font
notices remain in the image under `/usr/share/doc`; the recipe does not remove
them. Font substitution and unsupported embedded/animated elements may change
presentation fidelity. This is source rendering, not AI image understanding.

Existing Poppler licensing is separate from this image. Our test fixture writer
uses [python-pptx1.0.2](https://pypi.org/project/python-pptx/), MIT, copyright
Steve Canny. It is a development-only dependency; no third-party source or
unlicensed presentation was copied. These additions do not change the license
or copyright of the K-NOT repository or any model.
