FROM alpine:latest

# ca-certificates is required for outbound TLS; nodejs/npm come from Alpine.
RUN apk add --no-cache nodejs npm ca-certificates

RUN addgroup app && adduser app -G app -D
WORKDIR /home/app
USER app

COPY --chown=app:app package*.json ./

# impit ships platform-specific binaries selected through npm's os/cpu/libc
# metadata. Verify the module resolves during the build so a broken install
# cannot pass silently and fail only at runtime.
RUN npm --quiet set progress=false \
    && npm install --omit=dev --no-audit --no-fund \
    && node -e "import('impit').then(m => console.log('impit OK:', Object.keys(m)))" \
    && rm -rf ~/.npm

COPY --chown=app:app . ./

ENV APIFY_LOG_LEVEL=INFO

CMD npm start --silent
