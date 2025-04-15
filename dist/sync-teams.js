var __require = /* @__PURE__ */ ((x) => typeof require !== "undefined" ? require : typeof Proxy !== "undefined" ? new Proxy(x, {
  get: (a, b) => (typeof require !== "undefined" ? require : a)[b]
}) : x)(function(x) {
  if (typeof require !== "undefined") return require.apply(this, arguments);
  throw Error('Dynamic require of "' + x + '" is not supported');
});

// scripts/sync-teams.ts
import * as core from "@actions/core";
import * as github from "@actions/github";
import { readFileSync } from "fs";
import yaml from "js-yaml";
import { Octokit } from "@octokit/rest";
import process from "process";
async function syncTeams(configPath, dryRun) {
  const token = process.env.GITHUB_TOKEN;
  if (!token) throw new Error("Missing GITHUB_TOKEN");
  const org = github.context.repo.owner;
  const octokit = new Octokit({ auth: token });
  core.info(`\u{1F4C4} Using config: ${configPath}`);
  if (dryRun) core.info("\u{1F6AB} Dry-run mode enabled. No changes will be made.");
  const config = yaml.load(readFileSync(configPath, "utf8"));
  for (const team of config.teams) {
    const slug = team.name.toLowerCase().replace(/[^a-z0-9-]/g, "-");
    core.info(`
=== Syncing team: ${team.name} ===`);
    let exists = true;
    try {
      await octokit.teams.getByName({ org, team_slug: slug });
    } catch (err) {
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
          parent_team_id: team.parent_team_id || void 0
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
          role
        });
      }
    }
  }
}
if (__require.main === module) {
  const args = process.argv.slice(2);
  const getArg = (flag, fallback = "") => {
    const index = args.indexOf(flag);
    return index !== -1 && args[index + 1] ? args[index + 1] : fallback;
  };
  const configPath = process.env.INPUT_CONFIG_PATH || ".github/teams.yaml";
  const dryRun = process.env.INPUT_DRY_RUN === "true";
  syncTeams(configPath, dryRun).catch((err) => core.setFailed(err.message));
}
export {
  syncTeams
};
