import { syncTeams } from '../scripts/sync-teams';
import { writeFileSync } from 'fs';
import { join } from 'path';
import { vi } from 'vitest';

const tempConfigPath = join(__dirname, 'temp-teams.yaml');
const testOrg = 'test-org';

const mockOctokit = {
  teams: {
    getByName: vi.fn().mockRejectedValue({ status: 404 }),
    create: vi.fn().mockResolvedValue({}),
    addOrUpdateMembershipForUserInOrg: vi.fn().mockResolvedValue({}),
    listMembersInOrg: vi.fn().mockResolvedValue({ data: [] }),
    removeMembershipForUserInOrg: vi.fn().mockResolvedValue({}),
    list: vi.fn().mockResolvedValue({ data: [] }),
    deleteInOrg: vi.fn().mockResolvedValue({})
  },
  paginate: {
    iterator: vi.fn().mockImplementation((fn, params) => {
      return {
        [Symbol.asyncIterator]: async function* () {
          const response = await fn(params);
          yield response;
        }
      };
    })
  }
};

vi.mock('@octokit/rest', () => {
  return {
    Octokit: vi.fn().mockImplementation(() => mockOctokit)
  };
});

describe('syncTeams', () => {
  beforeEach(() => {
    process.env.GITHUB_TOKEN = 'test-token';
    process.env.GITHUB_REPOSITORY = 'example-org/example-repo';
    vi.clearAllMocks();
  });

  it('should not throw on empty team config (dry-run)', async () => {
    writeFileSync(tempConfigPath, 'teams: []');
    await expect(syncTeams(tempConfigPath, true, testOrg)).resolves.not.toThrow();
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

    await expect(syncTeams(tempConfigPath, true, testOrg)).resolves.not.toThrow();
  });

  it('should throw if GITHUB_TOKEN is missing', async () => {
    delete process.env.GITHUB_TOKEN;
    writeFileSync(tempConfigPath, 'teams: []');
    await expect(syncTeams(tempConfigPath, true, testOrg)).rejects.toThrow(/Missing GITHUB_TOKEN/);
  });

  it('should throw on malformed YAML', async () => {
    writeFileSync(tempConfigPath, 'teams:\n  - name: test\n    description "missing colon"');
    await expect(syncTeams(tempConfigPath, true, testOrg)).rejects.toThrow();
  });

  it('should handle member removal when not in config', async () => {
    // Mock existing team with members
    mockOctokit.teams.getByName.mockResolvedValueOnce({ data: { id: 1 } });
    mockOctokit.teams.listMembersInOrg.mockResolvedValueOnce({
      data: [{ login: 'bob' }, { login: 'alice' }]
    });

    writeFileSync(tempConfigPath, `teams:
      - name: test-team
        roles:
          - username: alice
            role: maintainer
    `);

    await syncTeams(tempConfigPath, false, testOrg);

    expect(mockOctokit.teams.removeMembershipForUserInOrg).toHaveBeenCalledWith({
      org: testOrg,
      team_slug: 'test-team',
      username: 'bob'
    });
  });

  it('should handle team removal when not in config', async () => {
    // Mock existing teams
    mockOctokit.teams.list.mockResolvedValueOnce({
      data: [{ slug: 'old-team', id: 1 }]
    });

    writeFileSync(tempConfigPath, `teams:
      - name: new-team
        roles: []
    `);

    await syncTeams(tempConfigPath, false, testOrg);

    expect(mockOctokit.teams.deleteInOrg).toHaveBeenCalledWith({
      org: testOrg,
      team_slug: 'old-team'
    });
  });
});
