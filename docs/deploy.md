# Deploying to Google Cloud Run

The whole app (API, plus the page when `web/` is merged) is one container, built by Google Cloud from the `Dockerfile`. Docker is not needed on your laptop.

## Why Cloud Run and not Vercel

Vercel runs short-lived functions: each request starts fresh and stops when it answers. This server needs one process that stays up:

- It loads Quebec's tables once at start-up (a few seconds, about 600 MB).
- It runs a background thread that fetches places outside Quebec from NASA for up to 40 minutes.
- Python functions on Vercel are limited to about 250 MB of code and libraries, and pandas, pyarrow and shapely together come close to that.

Vercel is fine for the page alone, if the frontend owner wants it there. The API stays on Cloud Run, and the page then calls the Cloud Run URL instead of `/api`.

## What it costs

One instance kept running with 1 CPU and 2 GB costs about US$2 a day in `northamerica-northeast1` (Montréal). It can be deleted after judging (see the end of this file). New Google Cloud accounts get US$300 of free credit.

## One-time setup

```bash
brew install --cask google-cloud-sdk        # then open a new terminal
gcloud auth login
gcloud config set project YOUR_PROJECT_ID   # a project with billing or credits
gcloud config set run/region northamerica-northeast1

gcloud services enable run.googleapis.com cloudbuild.googleapis.com \
    artifactregistry.googleapis.com secretmanager.googleapis.com storage.googleapis.com

# The NASA FIRMS key, kept as a secret (paste it, press Enter, then Ctrl-D)
gcloud secrets create firms-map-key --data-file=-

# A bucket so places fetched outside Quebec survive restarts
BUCKET=$(gcloud config get-value project)-fire-cache
gcloud storage buckets create gs://$BUCKET --location=northamerica-northeast1

# Let the service read the secret and write to the bucket
SA=$(gcloud projects describe $(gcloud config get-value project) --format='value(projectNumber)')-compute@developer.gserviceaccount.com
gcloud secrets add-iam-policy-binding firms-map-key --member=serviceAccount:$SA --role=roles/secretmanager.secretAccessor
gcloud storage buckets add-iam-policy-binding gs://$BUCKET --member=serviceAccount:$SA --role=roles/storage.objectAdmin
```

## Deploy (and redeploy after every change)

From the repo root, on the branch you want to ship:

```bash
BUCKET=$(gcloud config get-value project)-fire-cache
gcloud run deploy fire-calendar --source . \
    --min-instances 1 --max-instances 1 --no-cpu-throttling \
    --cpu 1 --memory 2Gi --timeout 300 \
    --execution-environment gen2 \
    --allow-unauthenticated \
    --set-secrets FIRMS_MAP_KEY=firms-map-key:latest \
    --add-volume name=cache,type=cloud-storage,bucket=$BUCKET \
    --add-volume-mount volume=cache,mount-path=/cache
```

Why each setting matters:

- **Exactly one instance, CPU always on:** the fetch queue lives in memory and works between requests. Two instances would fetch the same place twice and could exceed the FIRMS budget.
- **gen2 and the bucket at `/cache`:** fetched places are saved there (`FIRE_CACHE_DIR=/cache` is set in the image).
- **The key comes only from Secret Manager.** `.env` is excluded by `.gcloudignore` and `.dockerignore` and is never uploaded.

The command prints the service URL. The first deploy takes about 5 minutes.

## Check it

```bash
URL=$(gcloud run services describe fire-calendar --format='value(status.url)')
curl "$URL/api/about" | head -c 300
curl "$URL/api/activity?lat=49.9&lon=-74.4&radius_km=100&from=2023-05&to=2023-07"
curl "$URL/api/outlook?lat=49.9&lon=-74.4&radius_km=200&on=2023-06-01"
gcloud run services logs read fire-calendar --limit 50
```

## Before the demo

Ask a place outside Quebec once (for example Sacramento, `lat=38.5&lon=-121.5`) at least 40 minutes before presenting, so its history is already fetched and saved.

## Take it down after judging

```bash
gcloud run services delete fire-calendar
gcloud storage rm -r gs://$(gcloud config get-value project)-fire-cache
```
