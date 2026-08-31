FROM python:3.11-slim

WORKDIR /app

# MongoDB database tools (mongodump / mongorestore) — used for the byte-exact
# "full image" backup (webmaster console download) and the terminal restore
# (backend/restore_backup.py). Installed from MongoDB's official tools CDN:
# the Ubuntu 22.04 build runs on any modern glibc (Debian 12/trixie, Ubuntu
# 22.04+) and is published for both amd64 and arm64, so the same Dockerfile
# works for dev (Apple Silicon) and production (x86_64 Ubuntu).
ARG TARGETARCH
RUN apt-get update \
    && apt-get install -y --no-install-recommends curl ca-certificates \
    && if [ "${TARGETARCH}" = "amd64" ]; then MDB_ARCH=x86_64; else MDB_ARCH=arm64; fi \
    && curl -fsSL "https://fastdl.mongodb.org/tools/db/mongodb-database-tools-ubuntu2204-${MDB_ARCH}-100.12.0.tgz" -o /tmp/db-tools.tgz \
    && tar -xzf /tmp/db-tools.tgz -C /opt \
    && ln -s "/opt/mongodb-database-tools-ubuntu2204-${MDB_ARCH}-100.12.0/bin/mongodump" /usr/local/bin/mongodump \
    && ln -s "/opt/mongodb-database-tools-ubuntu2204-${MDB_ARCH}-100.12.0/bin/mongorestore" /usr/local/bin/mongorestore \
    && rm -f /tmp/db-tools.tgz \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .

RUN pip install --no-cache-dir -r requirements.txt

COPY . .

EXPOSE 8000

CMD ["uvicorn", "server:app", "--host", "0.0.0.0", "--port", "8000"]
