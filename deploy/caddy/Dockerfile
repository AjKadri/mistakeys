ARG CADDY_VERSION=2.11.7
ARG CADDY_RATELIMIT_VERSION=v0.1.0

FROM caddy:${CADDY_VERSION}-builder-alpine AS builder
ARG CADDY_RATELIMIT_VERSION
RUN xcaddy build --with github.com/mholt/caddy-ratelimit@${CADDY_RATELIMIT_VERSION}

FROM caddy:${CADDY_VERSION}-alpine
COPY --from=builder /usr/bin/caddy /usr/bin/caddy
