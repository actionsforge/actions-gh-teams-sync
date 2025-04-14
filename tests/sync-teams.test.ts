import { syncTeams } from '../scripts/sync-teams';
import { writeFileSync } from 'fs';
import { join } from 'path';
import { vi } from 'vitest';

const tempConfigPath = join(__dirname, 'temp-teams.yaml');

vi.mock('@octokit/rest', () => {
  return {
    Octokit: vi.fn().mockImplementation(() => ({
      teams: {
        getByName: vi.fn().mockRejectedValue({ status: 404 }),
        create: vi.fn().mockResolvedValue({}),
        addOrUpdateMembershipForUserInOrg: vi.fn().mockResolvedValue({})
      }
    }))
  };
});

describe('syncTeams', () => {
  beforeEach(() => {
    process.env.GITHUB_TOKEN = 'test-token';
    process.env.GITHUB_REPOSITORY = 'example-org/example-repo';
  });

  it('should not throw on empty team config (dry-run)', async () => {
    writeFileSync(tempConfigPath, 'teams: []');
    await expect(syncTeams(tempConfigPath, true)).resolves.not.toThrow();
  });

  it('should simulate creation of a team without throwing (dry-run)', async () => {
    writeFileSync(tempConfigPath, `teams:
      - name: test-team
        description: A test team
        privacy: closed
        roles:
          - username: alice
            role: maintainer
    `);

    await expect(syncTeams(tempConfigPath, true)).resolves.not.toThrow();
  });

  it('should throw if GITHUB_TOKEN is missing', async () => {
    delete process.env.GITHUB_TOKEN;
    writeFileSync(tempConfigPath, 'teams: []');
    await expect(syncTeams(tempConfigPath, true)).rejects.toThrow(/Missing GITHUB_TOKEN/);
  });

  it('should throw on malformed YAML', async () => {
    writeFileSync(tempConfigPath, 'teams:\n  - name: test\n    description "missing colon"');
    await expect(syncTeams(tempConfigPath, true)).rejects.toThrow();
  });
});
