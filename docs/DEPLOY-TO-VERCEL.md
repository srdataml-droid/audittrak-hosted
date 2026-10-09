# Deploy AuditTrak to your Vercel account

This package contains the React interface, a Vercel Function for the Fastify API, and a PostgreSQL backend. Local development still supports SQLite when DATABASE_URL is absent. Hosted accounts, sessions, jobs and attached evidence use PostgreSQL. Nothing depends on a local SQLite file on Vercel.

The prepared app is being uploaded to `srdataml-droid/audittrak-hosted`. Use that repository for Vercel import. The Vercel connection in this conversation could not create a project, so live deployment remains pending.

## 1. Put this version on GitHub

Download and extract `audittrak-vercel-ready.zip`. Open the extracted `audittrak` folder. It contains `package.json`, `vercel.json`, `api`, `src`, `ui` and the other project files.

If the repository is already cloned on your laptop:

1. Copy the contents of the extracted folder into your local `auditrak` repository folder, replacing matching files. Keep the existing `.git` folder.
2. In a terminal inside that repository, run:

```bash
git status
git add .
git commit -m "Prepare AuditTrak for Vercel with PostgreSQL persistence"
git push origin main
```

If you cannot push to Ifeoluwayemisi's repository, create a new private repository in your own GitHub account called `audittrak-hosted`. On its page choose **uploading an existing file** or **Add file → Upload files**. On a laptop, drag the contents of the extracted `audittrak` folder into the upload area and commit. Preserve the folder structure. `package.json` and `vercel.json` must appear directly at the repository root, not inside another `audittrak` folder. You can also ask the repository owner to upload this version.

Do not upload node_modules, a local database, or a real .env file. This ZIP excludes them. `.env.example` is only a blank example.

## 2. Copy the database URL from Neon

1. Open https://console.neon.tech and sign into your connected Neon account.
2. Choose the project **audittrak**, project ID `dry-salad-51623583`.
3. Open **Connect** for its default branch and database.
4. Enable **Connection pooling**.
5. Copy the full PostgreSQL connection string. Keep its SSL parameters.

This dedicated project's 18 application tables have already been created. The application also creates missing tables safely on startup. No real customer records were imported. The connection string includes a password: paste it only into Vercel's environment-variable value field, never into GitHub or a chat message.

## 3. Import the repository into Vercel

1. Open https://vercel.com/new.
2. Select your **srdataml-droids-projects** workspace.
3. Find and import **srdataml-droid/audittrak-hosted**.
4. If it is missing, use the GitHub access/configuration option to grant Vercel access. For the other owner's repository, that owner may need to authorize access. Using your own repository avoids that dependency.
5. Use **audittrak** as the Vercel project name, or another available name.

## 4. Check the build settings

| Setting          | Value                                  |
| ---------------- | -------------------------------------- |
| Framework preset | Other                                  |
| Root directory   | Repository root; leave the field empty |
| Install command  | npm ci                                 |
| Build command    | npm run build                          |
| Output directory | public/app                             |
| Node.js version  | 24.x                                   |

The supplied `vercel.json` already sets the install command, build command, output directory, API routing and London function region. Do not select `ui` as the root directory: the API and shared data live outside that folder. Do not set the build command to `npm start`.

## 5. Add environment variables before deploying

Expand **Environment Variables** on the import page.

| Name          | Value                                          |
| ------------- | ---------------------------------------------- |
| DATABASE_URL  | Full pooled connection string copied from Neon |
| COOKIE_SECURE | true                                           |

Select **Production** for both. If you enable Preview deployments too, use a separate Neon branch/database for Preview rather than sharing production data.

Do not add `AUDITTRAK_DATABASE`: hosted storage is PostgreSQL. Leave Mono and document-extraction settings unset for this initial deployment. `AUDITTRAK_SERVERLESS` is set by the entrypoint automatically.

## 6. Click Deploy

Wait for the deployment to show **Ready**, then open its assigned URL. If you add or correct an environment variable later, redeploy so the new deployment receives it.

## 7. Check the deployed app

1. Open `<your-vercel-url>/health`. It should return JSON with `status: "ok"`. This checks the function, not the database by itself.
2. Open the homepage and create a test business account. Choose a password with at least 12 characters.
3. Add the fictional examples to an empty workspace, or create a test job.
4. Run an assessment and open an attached evidence file.
5. Sign out, sign in again and confirm the records remain.
6. Redeploy once, then confirm the same account and records still exist. This checks persistence independently of a running function instance.

This is a hosted prototype. Use fictional records while the remaining pilot controls in `docs/whats-left.md` are unfinished. Email verification, password recovery, explicit institution-specific reviewer grants and file malware scanning are still future work. AI extraction and bank connections are optional and remain unconfigured.

## If deployment fails

| What you see                         | Check                                                                               |
| ------------------------------------ | ----------------------------------------------------------------------------------- |
| Build cannot find package.json       | Root directory; project files must be at the repository root                        |
| Homepage works but signup fails      | DATABASE_URL in Production; inspect Runtime Logs, not only build logs               |
| AuditTrak is temporarily unavailable | Missing or invalid database connection string, or database unavailable              |
| Signup/login returns 404             | api/index.ts and vercel.json must both be uploaded                                  |
| Files disappear after redeploy       | Confirm DATABASE_URL is set; no hosted SQLite configuration should be used          |
| Cookie does not work                 | Use the HTTPS Vercel URL and COOKIE_SECURE=true                                     |
| Upload returns 413                   | Maximum attachment size is 3 MiB; larger documents need a future direct-upload flow |

## What changed and what was verified

- Added the PostgreSQL backend, async database calls and transactions while keeping the local SQLite option.
- Added the Vercel Function entrypoint and routing configuration. It does not start a long-running listener.
- Added hosted asset paths, PostgreSQL duplicate-record handling and a 3 MiB upload limit to fit Vercel's request body limit after base64 encoding.
- Type checking, frontend build, existing application tests, PostgreSQL-engine persistence/isolation/rollback tests, and an HTTP test of the Function handler passed locally.
- The schema was successfully created on the dedicated Neon project. Direct app-to-Neon testing from this runtime was blocked by network DNS restrictions; SQL and persistence tests used embedded PostgreSQL (PGlite). The advisory lock and cloud connection still need the live deployment check above.
- No hosted deployment was created, so a real Vercel build and runtime check remain necessary.
