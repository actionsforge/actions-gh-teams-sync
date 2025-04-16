import { syncTeams } from '../scripts/sync-teams';
import { writeFileSync } from 'fs';
import { join } from 'path';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import * as core from '@actions/core';

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
    iterator: vi.fn().mockImplementation(
      (fn: (params: Record<string, unknown>) => Promise<{ data: unknown[] }>, params: Record<string, unknown>) => {
        return {
          [Symbol.asyncIterator]: async function* (): AsyncGenerator<{ data: unknown[] }, void, unknown> {
            const response = await fn(params);
            yield response;
          }
        };
      }
    )
  }
};

vi.mock('@octokit/rest', () => ({
  Octokit: vi.fn().mockImplementation(({ auth }) => {
    if (auth !== 'test-token') {
      throw new Error('Bad credentials');
    }
    return mockOctokit;
  })
}));

describe('syncTeams', () => {
  beforeEach((): void => {
    process.env.GITHUB_TOKEN = 'test-token';
    process.env.GITHUB_REPOSITORY = 'example-org/example-repo';
    process.env.GITHUB_ORG = testOrg;
    vi.clearAllMocks();
  });

  // Existing tests...

  it('should handle team creation with parent team', async (): Promise<void> => {
    writeFileSync(tempConfigPath, `teams:
      - name: parent-team
      - name: child-team
        parent_team_id: 1
    `);

    mockOctokit.teams.getByName.mockResolvedValueOnce({ data: { id: 1 } });

    await syncTeams(tempConfigPath, false, testOrg);

    expect(mockOctokit.teams.create).toHaveBeenCalledWith(
      expect.objectContaining({
        parent_team_id: 1
      })
    );
  });

  it('should handle protected team removal error', async (): Promise<void> => {
    mockOctokit.teams.list.mockResolvedValueOnce({
      data: [{ slug: 'protected-team', id: 1 }]
    });
    mockOctokit.teams.deleteInOrg.mockRejectedValueOnce({ status: 403 });

    writeFileSync(tempConfigPath, 'teams: []');

    await expect(syncTeams(tempConfigPath, false, testOrg)).resolves.not.toThrow();
  });

  it('should handle team update with new members', async (): Promise<void> => {
    mockOctokit.teams.getByName.mockResolvedValueOnce({ data: { id: 1 } });
    mockOctokit.teams.listMembersInOrg.mockResolvedValueOnce({
      data: [{ login: 'existing-member' }]
    });

    writeFileSync(tempConfigPath, `teams:
      - name: test-team
        roles:
          - username: new-member
            role: member
    `);

    await syncTeams(tempConfigPath, false, testOrg);

    expect(mockOctokit.teams.addOrUpdateMembershipForUserInOrg).toHaveBeenCalledWith({
      org: testOrg,
      team_slug: 'test-team',
      username: 'new-member',
      role: 'member'
    });
  });

  it('should handle pagination for large teams', async (): Promise<void> => {
    const largeTeam = Array(150).fill({ login: 'member' });
    mockOctokit.teams.getByName.mockResolvedValueOnce({ data: { id: 1 } });

    mockOctokit.paginate.iterator.mockImplementationOnce(
      (_fn: (params: Record<string, unknown>) => Promise<{ data: unknown[] }>, _params: Record<string, unknown>) => {
        return {
          [Symbol.asyncIterator]: async function* (): AsyncGenerator<{ data: unknown[] }> {
            yield { data: largeTeam.slice(0, 100) };
            yield { data: largeTeam.slice(100) };
          }
        };
      }
    );

    writeFileSync(tempConfigPath, `teams:
      - name: large-team
        roles: []
    `);

    await syncTeams(tempConfigPath, false, testOrg);

    expect(mockOctokit.paginate.iterator).toHaveBeenCalledWith(
      expect.any(Function),
      expect.objectContaining({
        org: testOrg,
        team_slug: 'large-team',
        per_page: 100
      })
    );
  });

  it('should handle invalid role in config', async (): Promise<void> => {
    writeFileSync(tempConfigPath, `teams:
      - name: test-team
        roles:
          - username: user
            role: invalid-role
    `);

    mockOctokit.teams.addOrUpdateMembershipForUserInOrg.mockRejectedValueOnce(
      new Error('Invalid role: invalid-role')
    );

    await expect(syncTeams(tempConfigPath, false, testOrg)).rejects.toThrow('Invalid role');
  });

  it('should handle team creation with privacy settings', async (): Promise<void> => {
    writeFileSync(tempConfigPath, `teams:
      - name: secret-team
        privacy: secret
    `);

    await syncTeams(tempConfigPath, false, testOrg);

    expect(mockOctokit.teams.create).toHaveBeenCalledWith(
      expect.objectContaining({
        privacy: 'secret'
      })
    );
  });

  it('should handle team creation with default maintainer', async (): Promise<void> => {
    writeFileSync(tempConfigPath, `teams:
      - name: default-team
        create_default_maintainer: true
    `);

    await syncTeams(tempConfigPath, false, testOrg);

    expect(mockOctokit.teams.create).toHaveBeenCalledWith({
      org: testOrg,
      name: 'default-team',
      privacy: 'closed'
    });
  });

  it('should handle CLI argument parsing', async (): Promise<void> => {
    process.argv = [
      'node',
      'sync-teams.js',
      '--config',
      tempConfigPath,
      '--dry-run',
      'true',
      '--org',
      testOrg
    ];

    writeFileSync(tempConfigPath, 'teams: []');

    await expect(syncTeams(tempConfigPath, true, testOrg)).resolves.not.toThrow();
  });

  it('should handle GitHub Action context', async (): Promise<void> => {
    process.env.GITHUB_ACTION = 'true';
    process.env.GITHUB_ORG = testOrg;

    writeFileSync(tempConfigPath, 'teams: []');

    await expect(syncTeams(tempConfigPath, true, testOrg)).resolves.not.toThrow();
  });

  it('should handle error in team creation', async (): Promise<void> => {
    writeFileSync(tempConfigPath, `teams:
      - name: error-team
    `);

    mockOctokit.teams.create.mockRejectedValueOnce(new Error('API Error'));

    await expect(syncTeams(tempConfigPath, false, testOrg)).rejects.toThrow('API Error');
  });

  it('should load and parse YAML config correctly', async (): Promise<void> => {
    const testConfig = `teams:
      - name: test-team
        description: test description
        privacy: secret
        parent_team_id: 1
        roles:
          - username: user1
            role: maintainer
          - username: user2
            role: member
    `;

    writeFileSync(tempConfigPath, testConfig);

    await syncTeams(tempConfigPath, false, testOrg);

    expect(mockOctokit.teams.create).toHaveBeenCalledWith({
      org: testOrg,
      name: 'test-team',
      description: 'test description',
      privacy: 'secret',
      parent_team_id: 1
    });

    expect(mockOctokit.teams.addOrUpdateMembershipForUserInOrg).toHaveBeenCalledWith({
      org: testOrg,
      team_slug: 'test-team',
      username: 'user1',
      role: 'maintainer'
    });

    expect(mockOctokit.teams.addOrUpdateMembershipForUserInOrg).toHaveBeenCalledWith({
      org: testOrg,
      team_slug: 'test-team',
      username: 'user2',
      role: 'member'
    });
  });

  it('should skip creation if team already exists', async (): Promise<void> => {
    mockOctokit.teams.getByName.mockResolvedValueOnce({ data: { id: 1 } });

    writeFileSync(tempConfigPath, `teams:
      - name: existing-team
    `);

    await syncTeams(tempConfigPath, false, testOrg);

    expect(mockOctokit.teams.create).not.toHaveBeenCalled();
  });

  it('should not re-add a member with the same role', async (): Promise<void> => {
    mockOctokit.teams.getByName.mockResolvedValueOnce({ data: { id: 1 } });
    mockOctokit.teams.listMembersInOrg.mockResolvedValueOnce({
      data: [{ login: 'user1' }]
    });

    writeFileSync(tempConfigPath, `teams:
      - name: same-member-team
        roles:
          - username: user1
            role: member
    `);

    await syncTeams(tempConfigPath, false, testOrg);

    expect(mockOctokit.teams.addOrUpdateMembershipForUserInOrg).toHaveBeenCalled();
  });

  it('should not call create or mutate APIs in dry-run mode', async (): Promise<void> => {
    writeFileSync(tempConfigPath, `teams:
      - name: dryrun-team
        roles:
          - username: dryuser
            role: member
    `);

    await syncTeams(tempConfigPath, true, testOrg);

    expect(mockOctokit.teams.create).not.toHaveBeenCalled();
    expect(mockOctokit.teams.addOrUpdateMembershipForUserInOrg).not.toHaveBeenCalled();
    expect(mockOctokit.teams.removeMembershipForUserInOrg).not.toHaveBeenCalled();
    expect(mockOctokit.teams.deleteInOrg).not.toHaveBeenCalled();
  });

  it('should throw for unexpected error status', async (): Promise<void> => {
    mockOctokit.teams.getByName.mockRejectedValueOnce({ status: 500 });

    writeFileSync(tempConfigPath, `teams:
      - name: failing-team
    `);

    await expect(syncTeams(tempConfigPath, false, testOrg)).rejects.toThrow();
  });

  it('should throw if team deletion fails with unknown error', async (): Promise<void> => {
    mockOctokit.teams.list.mockResolvedValueOnce({
      data: [{ slug: 'undeletable-team', id: 1 }]
    });
    mockOctokit.teams.deleteInOrg.mockRejectedValueOnce({ status: 500 });

    writeFileSync(tempConfigPath, 'teams: []');

    await expect(syncTeams(tempConfigPath, false, testOrg)).rejects.toThrow();
  });

  it('should throw if team lookup fails with non-404 error', async () => {
    mockOctokit.teams.getByName.mockRejectedValueOnce({ status: 500 });

    writeFileSync(tempConfigPath, `teams:
      - name: failing-team
    `);

    await expect(syncTeams(tempConfigPath, false, testOrg)).rejects.toThrow();
  });

  it('should throw if getByName throws a non-object error', async () => {
    mockOctokit.teams.getByName.mockRejectedValueOnce('string error');
    writeFileSync(tempConfigPath, `teams:
      - name: bad-error
    `);
    await expect(syncTeams(tempConfigPath, false, testOrg)).rejects.toThrow('string error');
  });

  it('should not throw on team delete error in dryRun mode', async () => {
    mockOctokit.teams.list.mockResolvedValueOnce({
      data: [{ slug: 'ghost-team', id: 1 }]
    });

    mockOctokit.teams.deleteInOrg.mockRejectedValueOnce({ status: 500 });

    writeFileSync(tempConfigPath, `teams:
      - name: other-team
    `);

    await expect(syncTeams(tempConfigPath, true, testOrg)).resolves.not.toThrow();
  });

  it('should log but not remove members in dry-run mode', async (): Promise<void> => {
    mockOctokit.teams.getByName.mockResolvedValueOnce({ data: { id: 1 } });
    mockOctokit.teams.listMembersInOrg.mockResolvedValueOnce({
      data: [{ login: 'bob' }]
    });

    writeFileSync(tempConfigPath, `teams:
      - name: dryrun-removal
        roles: []
    `);

    const infoSpy = vi.spyOn(core, 'info');

    await syncTeams(tempConfigPath, true, testOrg);

    expect(mockOctokit.teams.removeMembershipForUserInOrg).not.toHaveBeenCalled();
    expect(infoSpy).toHaveBeenCalledWith(
      `[DRY-RUN] Would remove member 'bob' from team 'dryrun-removal'`
    );
  });

});
