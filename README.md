# KargoPazar

ABD'ye satış yapan e-ticaret satıcıları için çok taşıyıcılı gönderi platformu: landing sayfası (`/`) ve demo paneli (`/app/`).

## Stack

- **Frontend**: Vue 3 + Vite + JavaScript
- **Hosting**: AWS Amplify
- **CI/CD**: GitHub Actions

## Repo layout

```
KargoPazar/
├── frontend/               Vue 3 + Vite + JavaScript
├── .github/workflows/      CI/CD pipelines (Amplify auto-deploy)
├── .vscode/                launch.json + tasks.json
├── amplify.yml             Amplify build config
├── start-dev.bat           Windows dev launcher
├── start-dev.sh            macOS / Linux dev launcher
├── .gitignore
└── README.md
```

## Local development

### Prerequisites

- Node.js 20+

### Run

**macOS / Linux:**
```bash
chmod +x start-dev.sh
./start-dev.sh
```

**Windows:**
```cmd
start-dev.bat
```

This runs `npm install` and starts Vite on `http://localhost:5173`.

- Landing: `http://localhost:5173/`
- Demo panel: `http://localhost:5173/app/` (login `demo` / `Demo123!`)

The panel is a second Vite entry (`frontend/app/index.html`) with hash routing (`/app/#/orders`), so deep links work on static hosting without rewrite rules. It has no backend: seed JSON (`frontend/src/app/data/seed/`, regenerate with `npm run seed`) plus localStorage behind a fake API layer. Developer conventions: `frontend/src/app/README.md`.

## Backend

ASP.NET Core 8 Web API (`backend/`, EF Core + MySQL 8 on AWS RDS, JWT auth) that stores all panel data; deployed as a container image to Amazon ECR (`.github/workflows/backend-ecr.yml`) and run on App Runner (port 8080, health check `/healthz`).

- API contract, env vars, local run and deployment: [`docs/BACKEND.md`](docs/BACKEND.md)
- Database scripts (`000_CreateDatabase.sql`, `001_InitialSchema.sql`, generated `002_SeedData.sql`) and RDS setup: [`database/README.md`](database/README.md), runner: `setup-database.bat`
- Checks without a database: `dotnet run --project tests/KargoPazar.RoundTrip`

Additional GitHub secret for the backend workflow: `ECR_REGISTRY` (`<account>.dkr.ecr.us-east-1.amazonaws.com`); the IAM user also needs ECR push permissions.

## GitHub setup

### 1 - Push the repo

```bash
git init
git add .
git commit -m "Initial commit (yp-project)"
gh repo create kargo-pazar --private --source=. --remote=origin --push
# or do it manually on github.com and:
# git remote add origin git@github.com:<your-org>/kargo-pazar.git
# git push -u origin main
```


### 2 - Add repository secrets

**Settings → Secrets and variables → Actions → New repository secret:**

| Secret name              | What it is                                              |
|--------------------------|---------------------------------------------------------|
| `AWS_ACCESS_KEY_ID`      | IAM user access key for Amplify deployment              |
| `AWS_SECRET_ACCESS_KEY`  | IAM user secret key                                     |
| `AMPLIFY_APP_ID`         | Amplify app ID, e.g. `d1abcd2efghij3`                   |

### 3 - Branch protection (optional, recommended)

**Settings → Branches → Add rule** for `main`: require PR, require status checks (the workflow names), require linear history.

## AWS - Amplify (frontend hosting)

All console links assume region **us-east-1**.

### Step 1 - Create an IAM deploy user

**IAM → Users → Create user → name: `kargopazar-github-deploy`.** Attach this inline policy:

<details>
<summary>IAM policy JSON (Amplify only)</summary>

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "AmplifyDeploy",
      "Effect": "Allow",
      "Action": [
        "amplify:StartJob",
        "amplify:GetJob",
        "amplify:ListBranches"
      ],
      "Resource": "*"
    }
  ]
}
```
</details>

Generate an access key (**Security credentials → Create access key → Application running outside AWS**) and copy both into the GitHub secrets `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY`.

### Step 2 - Create the Amplify app

1. **Amplify Console → Create new app → Host web app.**
2. Connect your GitHub repo and select `main` branch.
3. **Build settings:** Amplify auto-detects `amplify.yml`. Confirm it matches the file in this repo.
4. **App settings → Environment variables:**
   - `VITE_API_BASE_URL` = your backend API URL (e.g. `https://api.kargopazar.com/api`)
5. After the first build succeeds, copy the **App ID** into the GitHub secret `AMPLIFY_APP_ID`.

### Step 3 - (Optional) Custom domain

**Amplify Console → Domain management → Add domain.** Connect to Route 53 or your registrar.

## Troubleshooting

- **Amplify build fails.** Confirm `VITE_API_BASE_URL` is set in Amplify environment variables, and check that `amplify.yml` build commands match `package.json`.
- **GitHub Actions workflow doesn't trigger.** Check the `paths:` filter in `.github/workflows/frontend-amplify.yml` - it only runs on `frontend/**` changes.

---

If anything in the setup walkthrough is missing or feels stale, run `/yp-project fix` from this folder and the skill will detect what's missing and offer to add it.
