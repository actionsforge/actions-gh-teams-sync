# 🚀 GitHub Team Sync Action

![ci](https://github.com/actionsforge/actions-gh-team-sync/actions/workflows/ci.yml/badge.svg)

Sync your GitHub organization teams from a declarative YAML configuration using the GitHub API.

---

## ✅ Features

- Syncs teams by name, description, and privacy
- Assigns maintainers and members
- Supports dry-run mode for safe testing
- Usable as a CLI or a reusable GitHub Action

---

## 📦 Usage (as a GitHub Action)

```yaml
- uses: actionsforge/gh-team-sync@v1
  with:
    config-path: .github/teams.yaml
    dry-run: false
  env:
    GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

---

## 🔧 Inputs

| Name          | Description                             | Required | Default                |
|---------------|------------------------------------------|----------|------------------------|
| `config-path` | Path to the YAML config file             | No       | `.github/teams.yaml`   |
| `dry-run`     | Show what would happen without changes   | No       | `false`                |

---

## 📄 Sample `teams.yaml`

```yaml
teams:
  - name: platform-team
    description: Platform engineers responsible for CI/CD and infrastructure
    privacy: closed
    roles:
      - username: johnaaj
        role: maintainer
      - username: alice
        role: member
      - username: bob
        role: member

  - name: data-team
    description: Data engineering and analytics
    privacy: secret
    roles:
      - username: data-lead
        role: maintainer
      - username: analyst1
        role: member
```

---

## 🧪 Local Testing

```bash
export GITHUB_TOKEN=ghp_...
export GITHUB_REPOSITORY=your-org/your-repo
node dist/sync-teams.js --config .github/teams.yaml --dry-run
```

---

## 🧪 Run Unit Tests

```bash
npm install
npm run build
npm test
```

Tests are powered by [Vitest](https://vitest.dev) and include GitHub API mocking.

---

## 🔒 Permissions

To manage organization teams, use a token with `admin:org` scope.
The default `GITHUB_TOKEN` only works in org-owned repos with the correct permissions.

---

## 📝 License

This project is licensed under the MIT License. See the [LICENSE](LICENSE) file for details.
