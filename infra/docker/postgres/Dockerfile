FROM postgres:18.6

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    postgresql-18-postgis-3=3.6.4+dfsg-2.pgdg13+1 \
    postgresql-18-postgis-3-scripts=3.6.4+dfsg-2.pgdg13+1 \
    postgresql-18-partman=5.5.0-1.pgdg13+1 \
  && rm -rf /var/lib/apt/lists/*

COPY init/ /docker-entrypoint-initdb.d/

CMD ["postgres", "-c", "wal_level=logical", "-c", "max_replication_slots=16", "-c", "max_wal_senders=16"]
