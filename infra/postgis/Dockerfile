# PostgreSQL + PostGIS on the official multi-arch postgres image (amd64 for the EC2 host, arm64 for
# Apple Silicon laptops and the stage fallback). postgis/postgis publishes amd64 only.
ARG PG_MAJOR=17
FROM postgres:${PG_MAJOR}-bookworm
ARG PG_MAJOR
RUN apt-get update \
 && apt-get install -y --no-install-recommends "postgresql-${PG_MAJOR}-postgis-3" "postgresql-${PG_MAJOR}-postgis-3-scripts" \
 && rm -rf /var/lib/apt/lists/*
