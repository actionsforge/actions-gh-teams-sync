import * as core from "@actions/core";
import * as github from "@actions/github";
import { readFileSync } from "fs";
import yaml from "js-yaml";
import { Octokit } from "@octokit/rest";
import process from "process";

type TeamRole = {
  username: string;
  role: "member" | "maintainer";
};

type TeamSpec = {
  name: string;
  description?: string;
  privacy?: "closed" | "secret";
  parent_team_id?: number | null;
  create_default_maintainer?: boolean;
  roles?: TeamRole[];
};

type TeamsConfig = {
  teams: TeamSpec[];
};

export async function syncTeams(configPath: string, dryRun: boolean, org: string) {
  const token = process.env.GITHUB_TOKEN;
  if (!token) throw new Error("Missing GITHUB_TOKEN");

  const octokit = new Octokit({ auth: token });

  core.info(`📄 Using config: ${configPath}`);
  if (dryRun) core.info("🚫 Dry-run mode enabled. No changes will be made.");
  core.info(`🏛 Operating in org: ${org}`);

  const config = yaml.load(readFileSync(configPath, "utf8")) as TeamsConfig;

  for (const team of config.teams) {
    const slug = team.name.toLowerCase().replace(/[^a-z0-9-]/g, "-");
    core.info(`\n=== Syncing team: ${team.name} ===`);

    let exists = true;
    try {
      await octokit.teams.getByName({ org, team_slug: slug });
    } catch (err: any) {
      if (err.status === 404) exists = false;
      else throw err;
    }

    if (!exists) {
      if (dryRun) {
        core.info(`[DRY-RUN] Would create team '${team.name}'`);
      } else {
        core.info(`Creating team '${team.name}'`);
        await octokit.teams.create({
          org,
          name: team.name,
          description: team.description,
          privacy: team.privacy || "closed",
          parent_team_id: team.parent_team_id || undefined,
        });
      }
    } else {
      core.info(`Team '${team.name}' already exists`);
    }

    for (const { username, role } of team.roles || []) {
      if (dryRun) {
        core.info(`[DRY-RUN] Would set ${role} '${username}'`);
      } else {
        core.info(`Setting ${role} '${username}'`);
        await octokit.teams.addOrUpdateMembershipForUserInOrg({
          org,
          team_slug: slug,
          username,
          role,
        });
      }
    }
  }
}

// CLI & GitHub Action entrypoint
if (require.main === module) {
  const isGitHubAction = !!process.env.GITHUB_ACTION;

  let configPath: string;
  let dryRun: boolean;
  let org: string | undefined;

  if (isGitHubAction) {
    configPath = core.getInput("config-path") || ".github/teams.yaml";
    dryRun = core.getInput("dry-run").toLowerCase() === "true";

    // Get organization from various sources
    org = process.env.GITHUB_ORG ||
         github.context.payload.organization?.login ||
         github.context.repo.owner;

    if (!org) {
      core.setFailed("❌ No organization specified. Set GITHUB_ORG or ensure the action is running in an organization context.");
      process.exit(1);
    }
  } else {
    const args = process.argv.slice(2);

    const parseArgs = (): Record<string, string | boolean> => {
      const result: Record<string, string | boolean> = {};
      for (let i = 0; i < args.length; i++) {
        const current = args[i];
        const next = args[i + 1];

        if (current.startsWith("--")) {
          if (current.includes("=")) {
            const [flag, value] = current.split("=");
            result[flag] = value;
          } else if (!next || next.startsWith("--")) {
            result[current] = true;
          } else {
            result[current] = next;
            i++;
          }
        }
      }
      return result;
    };

    const parsed = parseArgs();

    configPath = (parsed["--config"] as string) || ".github/teams.yaml";
    const dryRunValue = parsed["--dry-run"];
    dryRun = dryRunValue === true ||
             dryRunValue === "true" ||
             dryRunValue === "" ||
             (typeof dryRunValue === "string" && dryRunValue.toLowerCase() === "true") ||
             (typeof dryRunValue === "string" && dryRunValue.toLowerCase() === "=true");
    org = (parsed["--org"] as string) || process.env.GITHUB_ORG;
  }

  if (!org) {
    core.setFailed("❌ No organization specified. Set --org or GITHUB_ORG.");
    process.exit(1);
  }

  core.info(`🧪 dryRun = ${dryRun}`);
  syncTeams(configPath, dryRun, org).catch(err => core.setFailed(err.message));
}
