# Secrets and local-data policy

K-not is a **public** repository. Nothing secret, and no uploaded document, may be committed.

| Never commit | Use instead |
| --- | --- |
| `.env`, `.env.docker`, any `.env.*` with values | `*.example` templates with `change-me` placeholders |
| Passwords or tokens in code, compose files or URLs | Environment variables (`DATABASE_URL`, `${MYSQL_PASSWORD}` …) |
| Seed / credential output (`seed_output*`, `*password*.txt`) | The seed writes generated passwords to a file **outside** the repo |
| Uploaded documents, `data/storage/`, extracted `pages.*.json` | Keep them local; tests use synthetic fixtures |
| Third-party course material (slides, books, exams) | Only with the rights holder's permission, never in this repo |

## Guards

- `.gitignore` covers the files above.
- `scripts/check-forbidden-files.sh` blocks them by name (Gitleaks cannot see binary, empty or
  UTF-16 files).
- `.gitleaks.toml`: default Gitleaks rules **plus** rules for database URLs with passwords,
  `MYSQL_*PASSWORD` assignments, K-not service secrets, seed output, env files and runtime
  storage. The default rules alone did not detect the 2026-10-09 exposure.
- `.gitleaksignore`: reviewed non-secrets only, each with a reason.
- CI (`.github/workflows/secret-scan.yml`) runs both checks on every push and pull request.
- Local pre-commit hook, once per clone:

  ```powershell
  winget install --id Gitleaks.Gitleaks     # or download v8.24.3 from GitHub releases and verify its SHA-256
  git config core.hooksPath .githooks       # Git for Windows runs the bash hook
  gitleaks git --redact --config .gitleaks.toml .   # optional: scan your local history
  ```

## Local database (Docker)

```powershell
copy .env.docker.example .env.docker      # new random values, see the comment in the file
docker compose --env-file .env.docker up -d
```

The port is bound to `127.0.0.1` only. `MYSQL_*` variables only initialise an **empty** volume;
to change a password on an existing database use `ALTER USER` (below).

## Incident 2026-10-09 (credentials committed to a public branch)

Commits `110efe7` and `68bda0c` on `feature/frontend-integration` (inherited by
`feature/rag-answer-quality`) contained the local MySQL root and application passwords, a
database URL with the application password, a seed log with four generated demo-account
passwords, and a third-party lecture deck with its extracted text. All of them are treated as
compromised. The replacement history starts from `c6d7d31` and contains none of them.

### Rotation on the Windows machine (values typed privately, never pasted into chat or files in the repo)

1. **Generate new values** (one per secret) in PowerShell:

   ```powershell
   function New-Secret { $b = New-Object byte[] 24; [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b); ([Convert]::ToBase64String($b)) -replace '[+/=]','' }
   ```

   Store them in your password manager, then in the untracked `.env.docker` and `backend\.env`.

2. **Rotate MySQL passwords on the existing container** (data is kept):

   ```powershell
   docker ps -a --format '{{.Names}}  {{.Image}}  {{.Ports}}'   # find the K-not MySQL container
   docker exec -it <container> mysql -uroot -p                   # old root password, typed at the prompt
   ```

   In the `mysql>` prompt (type the new values; they are not echoed to any file):

   ```sql
   SELECT user, host FROM mysql.user WHERE user IN ('root', '<app user>');
   ALTER USER 'root'@'%'         IDENTIFIED BY '<new root password>';   -- for every root host listed
   ALTER USER 'root'@'localhost' IDENTIFIED BY '<new root password>';
   ALTER USER '<app user>'@'%'   IDENTIFIED BY '<new app password>';    -- for every host listed
   FLUSH PRIVILEGES;
   ```

   Then clear the MySQL client history inside the container, which may contain the statements:
   `docker exec <container> sh -c 'rm -f /root/.mysql_history'`. In PowerShell, run
   `Clear-History`; PSReadLine keeps a file history too: `Remove-Item (Get-PSReadLineOption).HistorySavePath`
   (or delete only the affected lines).

3. **Close the network exposure**: recreate the container from the new `docker-compose.yml`
   (published on `127.0.0.1` only) **on the same volume**:

   ```powershell
   docker compose --env-file .env.docker up -d   # reuses the knot_db_data volume; check `docker volume ls` first
   ```

   If your old container has another name, stop it (`docker stop <old>`) instead of removing it until
   the new one is confirmed to use the same data (`docker inspect <name> --format '{{json .Mounts}}'`).

4. **Update `backend\.env`**: `DATABASE_URL=mysql://<app user>:<url-encoded new password>@127.0.0.1:3306/knot_dev?allowPublicKeyRetrieval=true`
   (`[Uri]::EscapeDataString($pw)` for the encoding). Restart the backend: `npm run start:local`.

5. **Rotate the four demo accounts** (admin, m.aydin, ayse, mehmet). The seed generates new
   random passwords and writes them **only** to a file outside the repository, readable only by
   you; nothing is printed:

   ```powershell
   cd backend
   $f = Join-Path $env:TEMP ("knot-users-" + [guid]::NewGuid() + ".json")
   [IO.File]::WriteAllText($f, '{"users":[{"email":"admin@knot.local","display_name":"Yönetici","role":"ADMIN"},{"email":"m.aydin@knot.local","display_name":"Doç. Dr. M. Aydın"},{"email":"ayse@knot.local","display_name":"Ayşe Yılmaz"},{"email":"mehmet@knot.local","display_name":"Mehmet Demir"}],"courses":[]}')
   npm run db:seed:local -- $f --rotate-passwords      # prints only the path of the credentials file
   Remove-Item $f
   ```

   Open the printed credentials file, move the passwords to your password manager, then delete it.
   `courses` is empty, so no course or membership changes; display names and roles are rewritten
   with their current values. Existing sessions stay valid until their 1-hour token expires; to end
   them at once, also rotate `JWT_SECRET` in `backend\.env` and restart the backend.

6. **Delete the local leftovers** (they are untracked after this change, but still on disk):
   `backend\seed_output.txt`, `backend\seed_passwords.txt`. Keep `data\storage\` only if you still
   need those uploads locally; it is ignored now.

7. **Check reuse**: if any exposed value was used anywhere else (another database, an account),
   change it there too.

8. **Figma**: `.figma-ds-state.json` holds a Figma file key (an identifier, not a token). Make sure
   the file's link sharing is restricted to people you invite.
