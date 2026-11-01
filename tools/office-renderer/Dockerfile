FROM debian:trixie-slim@sha256:f6b08b09a05725f9431502d3b5714f5c4576e82c1a84fa1debe0c24a7e0c3ec4
RUN apt-get update && apt-get install -y --no-install-recommends libreoffice-impress libreoffice-draw fonts-dejavu-core fonts-liberation2 && rm -rf /var/lib/apt/lists/*
ENV HOME=/tmp
USER 1000:1000
WORKDIR /work
ENTRYPOINT ["libreoffice", "-env:UserInstallation=file:///tmp/office-profile", "--headless", "--nologo", "--nodefault", "--nofirststartwizard", "--convert-to", "pdf:impress_pdf_Export", "--outdir", "/work", "/work/source.pptx"]
