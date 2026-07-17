# syntax=docker/dockerfile:1.7

# ---- elixir-builder ----
FROM hexpm/elixir:1.18.4-erlang-27.3.4-debian-bookworm-20250428-slim AS elixir-builder
RUN apt-get update && apt-get install -y --no-install-recommends build-essential git ca-certificates \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV MIX_ENV=prod
RUN mix local.hex --force && mix local.rebar --force
COPY mix.exs mix.lock ./
RUN mix deps.get --only prod
RUN mix deps.compile
COPY config ./config
COPY lib ./lib
COPY priv ./priv
RUN mix compile
RUN mix release
# Output: /app/_build/prod/rel/allay

# ---- runtime ----
FROM debian:bookworm-slim AS runtime
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      wget apt-transport-https gnupg curl ca-certificates libstdc++6 libncurses6 locales tar \
 && wget -qO - https://packages.adoptium.net/artifactory/api/gpg/key/public \
      | gpg --dearmor -o /usr/share/keyrings/adoptium.gpg \
 && echo "deb [signed-by=/usr/share/keyrings/adoptium.gpg] https://packages.adoptium.net/artifactory/deb bookworm main" \
      > /etc/apt/sources.list.d/adoptium.list \
 && apt-get update \
 && apt-get install -y --no-install-recommends temurin-21-jre temurin-25-jre \
 && rm -rf /var/lib/apt/lists/*
# UTF-8 locale for the BEAM
RUN sed -i '/en_US.UTF-8/s/^# //g' /etc/locale.gen && locale-gen
ENV LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8
WORKDIR /app
COPY --from=elixir-builder /app/_build/prod/rel/allay ./
RUN useradd -r -u 1000 allay && mkdir -p /app/data && chown -R allay:allay /app
USER allay
ENV DATA_DIR=/app/data PHX_SERVER=true PORT=4000
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD curl -fsS http://localhost:4000/health || exit 1
# migrate on boot then start
ENTRYPOINT ["/bin/sh", "-c", "bin/allay eval 'Allay.Release.migrate()' && exec bin/allay start"]
