# KargoPazar

Generated with [yp-project](https://github.com/youparcel/yp-project) on 2026.

## Stack

- **Frontend**: Vue 3 + Vite + TypeScript
- **CI/CD**: GitHub Actions

## Repo layout

```
kargo-pazar/
├── frontend/               Vue 3 + Vite + TypeScript
├── .github/workflows/      CI/CD pipelines
├── .vscode/                launch.json + tasks.json
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

## GitHub setup

### 1 — Push the repo

```bash
git init
git add .
git commit -m "Initial commit (yp-project)"
gh repo create kargo-pazar --private --source=. --remote=origin --push
# or do it manually on github.com and:
# git remote add origin git@github.com:<your-org>/kargo-pazar.git
# git push -u origin main
```

If you'll be using the dev environment workflows, also create a `develop` branch:
```bash
git checkout -b develop
git push -u origin develop
```

### 2 — Add repository secrets

**Settings → Secrets and variables → Actions → New repository secret.** Add the secrets that match the workflows you generated:

| Secret name              | What it is                                              |
|--------------------------|---------------------------------------------------------|
| `AWS_ACCESS_KEY_ID`      | IAM user access key (deploy user, see AWS section)      |
| `AWS_SECRET_ACCESS_KEY`  | IAM user secret key                                     |

For the **Amplify** workflow, also add:

| Secret name              | What it is                                              |
|--------------------------|---------------------------------------------------------|
| `AMPLIFY_APP_ID`         | Amplify app ID, e.g. `d1abcd2efghij3`                   |

### 3 — (Recommended) Create a `production` environment

**Settings → Environments → New environment → `production`.** Add required reviewers if you want a manual approval gate before prod deploys. The generated prod workflow already references `environment: production`.

### 4 — Branch protection (optional, recommended)

**Settings → Branches → Add rule** for `main`: require PR, require status checks (the workflow names), require linear history.

## AWS — Amplify (frontend hosting)

All console links assume region **us-east-1**.

### Step 1 — Create an IAM deploy user (skip if you've already done this for another project)

**IAM → Users → Create user → name: `kargo-pazar-github-deploy`.** Attach an inline policy:

<details>
<summary>IAM policy JSON (Amplify + ECR + ECS, least-privilege starter)</summary>

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "ECRAuthAndPush",
      "Effect": "Allow",
      "Action": [
        "ecr:GetAuthorizationToken",
        "ecr:BatchCheckLayerAvailability",
        "ecr:CompleteLayerUpload",
        "ecr:InitiateLayerUpload",
        "ecr:PutImage",
        "ecr:UploadLayerPart",
        "ecr:DescribeRepositories",
        "ecr:DescribeImages"
      ],
      "Resource": "*"
    },
    {
      "Sid": "ECSDeploy",
      "Effect": "Allow",
      "Action": [
        "ecs:DescribeServices",
        "ecs:UpdateService",
        "ecs:DescribeTaskDefinition",
        "ecs:RegisterTaskDefinition"
      ],
      "Resource": "*"
    },
    {
      "Sid": "AmplifyDeploy",
      "Effect": "Allow",
      "Action": [
        "amplify:StartJob",
        "amplify:GetJob",
        "amplify:ListBranches"
      ],
      "Resource": "*"
    },
    {
      "Sid": "PassRoleForECS",
      "Effect": "Allow",
      "Action": "iam:PassRole",
      "Resource": "*",
      "Condition": {
        "StringEquals": { "iam:PassedToService": "ecs-tasks.amazonaws.com" }
      }
    }
  ]
}
```
</details>

After creating the user, generate an access key (**Security credentials → Create access key → Application running outside AWS**) and copy both keys into the GitHub secrets `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY`.

### Step 2 — Create the Amplify app

1. **Amplify Console → Create new app → Host web app.**
2. Connect your GitHub repo. Select branch `main` → click **Next**.
3. **Build settings:** Amplify auto-detects `frontend/amplify.yml`. If not, paste in the contents of that file from this repo.
4. **App settings → Environment variables:**
   - `VITE_API_BASE_URL` = your prod API URL (e.g. `https://api.kargo-pazar.example.com`)
   - `VITE_APP_ENV` = `production`
5. After the first build succeeds, copy the **App ID** (looks like `d1abcd2efghij3`) into the GitHub secret `AMPLIFY_APP_ID`.
6. (Optional) Connect the `develop` branch as a separate Amplify branch for a dev preview URL. Set its `VITE_API_BASE_URL` to the dev API URL.

### Step 3 — (Optional) Custom domain

**Amplify Console → Domain management → Add domain.** Connect to your Route 53 hosted zone (or paste DNS records into your registrar).

## Troubleshooting

- **Amplify build fails on `npm run build`.** Confirm `VITE_API_BASE_URL` is set in Amplify environment variables, and that the build command in `amplify.yml` matches `package.json`.
- **CI fails to find files.** The workflow `paths:` filters are scoped to `frontend/**` and `backend/**`. If you reorganize the repo, update those filters.

---

If anything in the setup walkthrough is missing or feels stale, run `/yp-project fix` from this folder and the skill will detect what's missing and offer to add it.
