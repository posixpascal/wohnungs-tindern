# Swipe app (app/) as a single compiled binary on a slim Debian base.
# The scraper is not part of the image: it runs on the host next to the coding
# agent and its headed browser, and pushes to this app via WOHNUNG_URL.

FROM oven/bun:1 AS build
WORKDIR /src/app
COPY app/package.json app/bun.lock ./
RUN bun install --frozen-lockfile
COPY app/ ./
COPY db/schema.sql /src/db/schema.sql
# Native target of the build platform (linux-x64 or linux-arm64).
RUN bun run build:web \
 && bun build --compile --minify src/index.ts --outfile /out/wohnung

FROM debian:bookworm-slim
# Fixed uid/gid so a fresh named volume at /data is owned by the app user.
RUN groupadd --system --gid 10001 wohnung \
 && useradd --system --uid 10001 --gid wohnung --no-create-home --shell /usr/sbin/nologin wohnung \
 && install -d -o wohnung -g wohnung -m 0700 /data
COPY --from=build /out/wohnung /usr/local/bin/wohnung
USER wohnung
ENV HOST=0.0.0.0 \
    PORT=3000 \
    DB_PATH=/data/wohnung.sqlite
VOLUME /data
EXPOSE 3000
ENTRYPOINT ["wohnung"]
CMD ["serve"]
