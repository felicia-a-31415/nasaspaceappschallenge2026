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

# The Google Maps browser key for search suggestions (same way). It ends up in the page,
# so restrict it in the console: Websites = the service URLs, API = Places API (New) only.
gcloud secrets create google-maps-browser-key --data-file=-

# A bucket so places fetched outside Quebec survive restarts
BUCKET=$(gcloud config get-value project)-fire-cache
gcloud storage buckets create gs://$BUCKET --location=northamerica-northeast1

# Let the service read the secret and write to the bucket
SA=$(gcloud projects describe $(gcloud config get-value project) --format='value(projectNumber)')-compute@developer.gserviceaccount.com
gcloud secrets add-iam-policy-binding firms-map-key --member=serviceAccount:$SA --role=roles/secretmanager.secretAccessor
gcloud secrets add-iam-policy-binding google-maps-browser-key --member=serviceAccount:$SA --role=roles/secretmanager.secretAccessor
gcloud storage buckets add-iam-policy-binding gs://$BUCKET --member=serviceAccount:$SA --role=roles/storage.objectAdmin
```

## Deploy (and redeploy after every change)

From the repo root, on the branch you want to ship. Two steps: build the image (Cloud Build
passes the Maps key from Secret Manager into the page build, see `cloudbuild.yaml`), then
run it.

```bash
gcloud builds submit --config cloudbuild.yaml --region=northamerica-northeast1

PROJECT=$(gcloud config get-value project)
BUCKET=$PROJECT-fire-cache
gcloud run deploy fire-calendar \
    --image northamerica-northeast1-docker.pkg.dev/$PROJECT/cloud-run-source-deploy/fire-calendar:latest \
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
- **Keys come only from Secret Manager.** `.env` is excluded by `.gcloudignore` and `.dockerignore` and is never uploaded. The FIRMS key is given to the running server; the Maps key is given to the page build, because the browser needs it.
- **Why not `gcloud run deploy --source .`:** it cannot pass a build argument, so the page would be built without the Maps key and fall back to search without suggestions.

The build takes about 5 minutes; the deploy prints the service URL, which serves both the page and `/api`.

## The custom domain (itss.earth)

Cloud Run cannot map a custom domain in `northamerica-northeast1`, so Firebase Hosting sits
in front: `firebase.json` sends every request to the `fire-calendar` service, and the domain
is attached to Firebase. The `hosting/` folder is empty on purpose.

This only needs redoing if `firebase.json` changes; a new Cloud Run revision is picked up
automatically.

```bash
gcloud auth application-default login           # once; firebase-tools uses it
npx -y firebase-tools@13 deploy --only hosting
```

The domain itself is added once in the Firebase console (Hosting, Add custom domain), with
the DNS records it gives entered at the registrar (Porkbun). Every address the page is
served from also has to be on the Maps key's website list.

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
