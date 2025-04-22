import * as core from "@actions/core";
import * as github from "@actions/github";
import { readFileSync, existsSync } from "fs";
import yaml from "js-yaml";
import { Octokit } from "@octokit/rest";
import process from "process";

export type SyncTeamsModule = {
  syncTeams: (configPath: string, dryRun: boolean, org: string) => Promise<void>;
  parseCliArgs: (args: string[]) => Record<string, string | boolean>;
  parseDryRun: (value: string | boolean | undefined) => boolean;
  runEntrypoint: () => Promise<void>;
};

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

function getErrorStatus(err: unknown): number | undefined {
  if (err && typeof err === "object" && "status" in err) {
    return (err as { status: number }).status;
  }
  return undefined;
}

async function verifyTokenPermissions(octokit: Octokit, org: string): Promise<void> {
  try {
    await octokit.orgs.get({ org });
  } catch (err) {
    if (getErrorStatus(err) === 404) {
      throw new Error(`Organization '${org}' not found or token lacks access`);
    }
    if (getErrorStatus(err) === 403) {
      throw new Error('Token lacks required permissions. Please ensure it has admin:org scope.');
    }
    throw err;
  }
}

export async function syncTeams(configPath: string, dryRun: boolean, org: string): Promise<void> {
  const token = process.env.GITHUB_TOKEN;
  if (!token) throw new Error("Missing GITHUB_TOKEN");

  const octokit = new Octokit({ auth: token });

  // Verify token permissions before proceeding
  await verifyTokenPermissions(octokit, org);

  core.info(`📄 Using config: ${configPath}`);
  core.info(`🚫 Dry-run mode: ${dryRun}`);
  core.info(`🏛 Operating in org: ${org}`);

  if (!existsSync(configPath)) {
    throw new Error(`Config file not found at: ${configPath}`);
  }

  const config = yaml.load(readFileSync(configPath, "utf8")) as TeamsConfig;

  const existingTeams = new Map<string, number>();
  for await (const response of octokit.paginate.iterator(octokit.teams.list, {
    org,
    per_page: 100,
  })) {
    for (const team of response.data) {
      existingTeams.set(team.slug, team.id);
    }
  }

  // Track teams that should exist
  const teamsToKeep = new Set<string>();

  for (const team of config.teams) {
    const slug = team.name.toLowerCase().replace(/[^a-z0-9-]/g, "-");
    teamsToKeep.add(slug);
    core.info(`\n=== Syncing team: ${team.name} ===`);

    let exists = true;
    try {
      await octokit.teams.getByName({ org, team_slug: slug });
    } catch (err: unknown) {
      const status = getErrorStatus(err);
      if (status === 404) {
        exists = false;
      } else {
        throw err;
      }
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
          create_default_maintainer: team.create_default_maintainer || false,
        });
      }
    } else {
      core.info(`Team '${team.name}' already exists`);
    }

    // Get current team members
    const currentMembers = new Set<string>();
    for await (const response of octokit.paginate.iterator(octokit.teams.listMembersInOrg, {
      org,
      team_slug: slug,
      per_page: 100,
    })) {
      for (const member of response.data) {
        currentMembers.add(member.login);
      }
    }

    // Track members that should be in the team
    const membersToKeep = new Set<string>();

    for (const { username, role } of team.roles || []) {
      membersToKeep.add(username);
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

    // Remove members that are no longer in the config
    for (const member of currentMembers) {
      if (!membersToKeep.has(member)) {
        if (dryRun) {
          core.info(`[DRY-RUN] Would remove member '${member}' from team '${team.name}'`);
        } else {
          core.info(`Removing member '${member}' from team '${team.name}'`);
          await octokit.teams.removeMembershipForUserInOrg({
            org,
            team_slug: slug,
            username: member,
          });
        }
      }
    }
  }

  // Remove teams that are no longer in the config
  for (const [slug] of existingTeams) {
    if (!teamsToKeep.has(slug)) {
      if (dryRun) {
        core.info(`[DRY-RUN] Would remove team '${slug}'`);
      } else {
        try {
          core.info(`Removing team '${slug}'`);
          await octokit.teams.deleteInOrg({
            org,
            team_slug: slug,
          });
        } catch (err: unknown) {
          const status = getErrorStatus(err);
          if (status === 403) {
            core.warning(`Cannot remove team '${slug}': Permission denied. The team might be protected.`);
          } else {
            throw err;
          }
        }
      }
    }
  }
}

export function parseCliArgs(args: string[]): Record<string, string | boolean> {
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
}

export function parseDryRun(value: string | boolean | undefined): boolean {
  return value === true ||
         value === "true" ||
         value === "" ||
         (typeof value === "string" && value.toLowerCase() === "true") ||
         (typeof value === "string" && value.toLowerCase() === "=true");
}

export const runEntrypoint = async (): Promise<void> => {
  const isGitHubAction = !!process.env.GITHUB_ACTION;

  let configPath: string;
  let dryRun: boolean;
  let org: string | undefined;

  if (isGitHubAction) {
    // First try explicit input
    org = core.getInput("org");

    // Then try environment
    if (!org) {
      org = process.env.GITHUB_ORG;
    }

    // Finally try context
    if (!org) {
      org = github.context.payload.organization?.login || github.context.repo.owner;
    }

    if (!org) {
      core.setFailed("❌ No organization specified. Please provide 'org' input or set GITHUB_ORG environment variable.");
      process.exit(1);
    }

    configPath = core.getInput("config-path") || ".github/teams.yaml";
    dryRun = core.getInput("dry-run").toLowerCase() === "true";
  } else {
    const args = process.argv.slice(2);
    const parsed = parseCliArgs(args);

    configPath = (parsed["--config"] as string) || ".github/teams.yaml";
    dryRun = parseDryRun(parsed["--dry-run"]);
    org = (parsed["--org"] as string) || process.env.GITHUB_ORG;
  }

  if (!org) {
    core.setFailed("❌ No organization specified. Set --org or GITHUB_ORG.");
    process.exit(1);
  }

  core.info(`🧪 dryRun = ${dryRun}`);
  try {
    await syncTeams(configPath, dryRun, org);
  } catch (err) {
    core.setFailed(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
};

if (require.main === module) {
  runEntrypoint();
}
