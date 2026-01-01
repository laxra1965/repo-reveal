FROM denoland/deno:1.40.0

WORKDIR /app

# Copy all function files
COPY supabase/functions/ ./functions/

# Expose port
EXPOSE 8000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD deno eval "fetch('http://localhost:8000/health').then(r => r.ok ? Deno.exit(0) : Deno.exit(1))"

# Run unified HTTP server
CMD ["deno", "run", "--allow-net", "--allow-env", "--allow-read", "functions/server.ts"]

