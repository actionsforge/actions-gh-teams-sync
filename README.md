# 🚀 GitHub Team Sync

![CI](https://github.com/actionsforge/actions-gh-teams-sync/actions/workflows/ci.yml/badge.svg)

[![Build, Commit, Tag & Release](https://github.com/actionsforge/actions-gh-teams-sync/actions/workflows/build-and-tag.yml/badge.svg)](https://github.com/actionsforge/actions-gh-teams-sync/actions/workflows/build-and-tag.yml)

Sync your GitHub organization teams from a declarative YAML configuration using the GitHub API.

---

## ✅ Features

- Syncs teams by name, description, and privacy
- Assigns maintainers and members
- Manages repository access and permissions
- Supports dry-run mode for safe testing
- Usable as a CLI or a reusable GitHub Action

---

## 📦 Usage (as a GitHub Action)

```yaml
- uses: actionsforge/actions-gh-teams-sync@v1
  with:
    config-path: .github/teams.yaml
    dry-run: false
  env:
    GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

---

## 🔧 Inputs

| Name          | Description                                           | Required | Default                |
|---------------|--------------------------------------------------------|----------|------------------------|
| `config-path` | Relative path to the YAML configuration file           | No       | `.github/teams.yaml`   |
| `dry-run`     | If true, prints planned changes without applying them | No       | `false`                |

---

## 📄 Sample `teams.yaml`

```yaml
# .github/teams.yaml
teams:
  - name: platform-team                # Required: Team name (will be converted to slug)
    description: Platform engineers    # Optional: Team description
    privacy: closed                   # Optional: Team privacy ('closed' or 'secret', defaults to 'closed')
    parent_team_id: 123              # Optional: ID of parent team for nested teams
    create_default_maintainer: false  # Optional: Whether to create default maintainer (defaults to false)
    roles:                           # Optional: List of team members and their roles
      - username: john            # Required: GitHub username
        role: maintainer             # Required: Role ('member' or 'maintainer')
      - username: alice
        role: member
      - username: bob
        role: member
    repositories:                    # Optional: List of repositories and their permissions
      - name: platform-core         # Required: Repository name
        permission: admin           # Required: Permission level
      - name: platform-tools
        permission: push

  - name: data-team
    description: Data engineering and analytics
    privacy: secret                  # 'secret' teams are only visible to team members
    roles:
      - username: data-lead
        role: maintainer
      - username: analyst1
        role: member
    repositories:
      - name: data-pipeline
        permission: admin
      - name: analytics-dashboard
        permission: push
```

### Team Configuration Parameters

| Parameter | Required | Description | Valid Values | Default |
|-----------|----------|-------------|--------------|---------|
| `name` | Yes | Team name | Any string | - |
| `description` | No | Team description | Any string | - |
| `privacy` | No | Team visibility | `closed` or `secret` | `closed` |
| `parent_team_id` | No | ID of parent team | Number | - |
| `create_default_maintainer` | No | Create default maintainer | `true` or `false` | `false` |
| `roles` | No | Team members and roles | Array of role objects | - |
| `repositories` | No | Repository access and permissions | Array of repository objects | - |

### Role Configuration Parameters

| Parameter | Required | Description | Valid Values |
|-----------|----------|-------------|--------------|
| `username` | Yes | GitHub username | Valid GitHub username |
| `role` | Yes | Team role | `member` or `maintainer` |

### Repository Configuration Parameters

| Parameter | Required | Description | Valid Values |
|-----------|----------|-------------|--------------|
| `name` | Yes | Repository name | Valid repository name in the organization |
| `permission` | Yes | Access level | `pull`, `triage`, `push`, `maintain`, or `admin` |

---

## 🦪 Local Testing (CLI)

```bash
# Dry run
GITHUB_TOKEN=ghp_... \
GITHUB_ORG=cloudbuildlab \
node dist/sync-teams.js --config .github/teams.yaml --dry-run

# Apply changes
GITHUB_TOKEN=ghp_... \
GITHUB_ORG=cloudbuildlab \
node dist/sync-teams.js --config .github/teams.yaml
```

---

## 🔒 Permissions

To manage organization teams, use a token with the `admin:org` scope.
The default `GITHUB_TOKEN` only works in **organization-owned** repositories and must have the `admin:org` scope enabled via workflow permissions. <https://docs.github.com/en/actions/security-guides/automatic-token-authentication#permissions-for-the-github_token>

---

## 📝 License

This project is licensed under the MIT License. See the [LICENSE](LICENSE) file for details.
