# Stage 1: compile the TypeScript runtime module to a single ES5 bundle.
# Full node image (not alpine) because it ships git, which npm needs to fetch
# the runtime type definitions from GitHub (heroiclabs/nakama-common).
FROM node:22-bookworm AS build
WORKDIR /build
COPY modules/package*.json ./
# Optional build secret "extra_ca": a PEM bundle for building behind a
# TLS-intercepting proxy. Only affects this throwaway stage; harmless when absent.
#   docker build --secret id=extra_ca,src=/path/to/ca.pem ...
RUN --mount=type=secret,id=extra_ca,required=false \
    if [ -s /run/secrets/extra_ca ]; then \
      export NODE_EXTRA_CA_CERTS=/run/secrets/extra_ca GIT_SSL_CAINFO=/run/secrets/extra_ca; \
    fi; \
    npm ci
COPY modules/tsconfig.json ./
COPY modules/src ./src
RUN npx tsc

# Stage 2: Nakama with the compiled module and config baked in.
FROM heroiclabs/nakama:3.42.0
COPY --from=build /build/build/index.js /nakama/data/modules/build/index.js
COPY config/local.yml /nakama/data/local.yml
