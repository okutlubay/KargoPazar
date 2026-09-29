# KargoPazar API image (ECR -> App Runner).
# Build context is the REPO ROOT because the seed JSON is embedded from
# frontend/src/app/data/seed (single source):
#   docker build -f backend/Dockerfile -t kargopazar-api .

# Build stage
FROM mcr.microsoft.com/dotnet/sdk:8.0 AS build
WORKDIR /src

# Copy csproj and restore dependencies first (faster caching)
COPY backend/KargoPazar.csproj backend/
RUN dotnet restore backend/KargoPazar.csproj

# Copy the sources plus the seed files the csproj links as embedded resources, then publish
COPY backend/ backend/
COPY frontend/src/app/data/seed/ frontend/src/app/data/seed/
RUN dotnet publish backend/KargoPazar.csproj -c Release -o /out --no-restore

# Runtime stage
FROM mcr.microsoft.com/dotnet/aspnet:8.0
WORKDIR /app

# curl for the container health check
RUN apt-get update \
 && apt-get install -y --no-install-recommends curl \
 && rm -rf /var/lib/apt/lists/*

# App Runner expects app to listen on port 8080
ENV ASPNETCORE_URLS=http://+:8080
ENV ASPNETCORE_ENVIRONMENT=Production
EXPOSE 8080

COPY --from=build /out .

# Non-root user shipped with the .NET 8 images (uid 1654)
USER $APP_UID

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD curl -fsS http://localhost:8080/healthz || exit 1

ENTRYPOINT ["dotnet", "KargoPazar.dll"]
