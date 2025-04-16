import { writeFileSync, unlinkSync, existsSync } from 'fs';
import { join } from 'path';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as core from '@actions/core';
import type { PathLike } from 'fs';

// Mock Octokit
const mockOctokit = {
  orgs: {
    get: vi.fn().mockResolvedValue({ data: {} }),
    listMembers: vi.fn().mockResolvedValue({ data: [] }),
    listTeams: vi.fn().mockResolvedValue({ data: [] }),
    createTeam: vi.fn().mockResolvedValue({ data: {} }),
    updateTeam: vi.fn().mockResolvedValue({ data: {} }),
    addOrUpdateMembership: vi.fn().mockResolvedValue({ data: {} }),
    removeMembership: vi.fn().mockResolvedValue({ data: {} }),
  },
  teams: {
    getByName: vi.fn().mockImplementation(({ _team_slug }) => {
      // Default to 404 for all teams unless overridden in specific tests
      return Promise.reject({ status: 404 });
    }),
    create: vi.fn().mockResolvedValue({ data: { id: 1 } }),
    update: vi.fn().mockResolvedValue({ data: {} }),
    deleteInOrg: vi.fn().mockResolvedValue({ data: {} }),
    addOrUpdateMembershipForUserInOrg: vi.fn().mockResolvedValue({ data: {} }),
    removeMembershipForUserInOrg: vi.fn().mockResolvedValue({ data: {} }),
    listMembersInOrg: vi.fn().mockResolvedValue({ data: [] }),
    list: vi.fn().mockResolvedValue({ data: [] }),
  },
  paginate: {
    iterator: vi.fn().mockImplementation((fn, params) => {
      return {
        [Symbol.asyncIterator]: async function* (): AsyncGenerator<{ data: unknown[] }> {
          const response = await fn(params);
          yield { data: response.data || [] };
        }
      };
    })
  }
};

vi.mock("@octokit/rest", () => {
  return {
    Octokit: vi.fn().mockImplementation(() => mockOctokit),
  };
});

// Mock core functions
vi.mock("@actions/core", () => ({
  getInput: vi.fn(),
  setFailed: vi.fn(),
  info: vi.fn(),
  warning: vi.fn()
}));

// Mock GitHub context
vi.mock("@actions/github", () => ({
  context: {
    repo: {
      owner: "test-org",
      repo: "test-repo",
    },
    payload: {
      organization: {
        login: "test-org"
      }
    }
  },
}));

// Mock process
vi.mock("process", () => {
  const processModule = {
    argv: [],
    env: {
      GITHUB_TOKEN: 'test-token',
      GITHUB_REPOSITORY: 'example-org/example-repo',
      GITHUB_ORG: 'test-org'
    },
    exit: vi.fn(),
  };
  return {
    default: processModule,
    ...processModule
  };
});

// Mock fs
vi.mock("fs", () => ({
  readFileSync: vi.fn().mockReturnValue('test content'),
  existsSync: vi.fn().mockReturnValue(true),
  writeFileSync: vi.fn(),
  unlinkSync: vi.fn(),
}));

// Mock js-yaml
vi.mock("js-yaml", () => ({
  default: {
    load: vi.fn().mockReturnValue({
      teams: [
        {
          name: 'secret-team',
          description: 'A secret team',
          privacy: 'secret'
        }
      ]
    })
  }
}));

// Import the module after mocks are set up
let syncTeams: typeof import('../scripts/sync-teams').syncTeams;
let runEntrypoint: typeof import('../scripts/sync-teams').runEntrypoint;
let parseCliArgs: typeof import('../scripts/sync-teams').parseCliArgs;
let parseDryRun: typeof import('../scripts/sync-teams').parseDryRun;

const tempConfigPath = join(__dirname, 'temp-teams.yaml');
const testOrg = 'test-org';

describe('syncTeams', () => {
  const originalEnv = { ...process.env };
  const originalArgv = [...process.argv];
  const originalExit = process.exit;

  beforeEach(async (): Promise<void> => {
    // Reset environment and set required variables
    process.env = {
      ...originalEnv,
      GITHUB_TOKEN: 'test-token',
      GITHUB_REPOSITORY: 'example-org/example-repo',
      GITHUB_ORG: testOrg
    };

    // Reset argv
    process.argv = [...originalArgv];

    // Mock process.exit
    process.exit = vi.fn() as unknown as (code?: number) => never;

    // Reset all mocks
    vi.clearAllMocks();

    // Mock existsSync to return true for our temp config
    vi.mocked(existsSync).mockImplementation((path: PathLike) => {
      return path === tempConfigPath;
    });

    // Reset all Octokit mocks
    Object.values(mockOctokit).forEach(mock => {
      if (typeof mock === 'object' && mock !== null) {
        Object.values(mock).forEach(fn => {
          if (typeof fn === 'function' && 'mockReset' in fn) {
            fn.mockReset();
          }
        });
      }
    });

    // Set up default mocks
    mockOctokit.orgs.get.mockResolvedValue({ data: {} });
    mockOctokit.teams.getByName.mockRejectedValue({ status: 404 });
    mockOctokit.teams.list.mockResolvedValue({ data: [] });
    mockOctokit.teams.create.mockResolvedValue({ data: { id: 1 } });
    mockOctokit.teams.update.mockResolvedValue({ data: {} });
    mockOctokit.teams.deleteInOrg.mockResolvedValue({ data: {} });
    mockOctokit.teams.addOrUpdateMembershipForUserInOrg.mockResolvedValue({ data: {} });
    mockOctokit.teams.removeMembershipForUserInOrg.mockResolvedValue({ data: {} });
    mockOctokit.teams.listMembersInOrg.mockResolvedValue({ data: [] });

    // Set up paginate.iterator mock
    mockOctokit.paginate.iterator.mockImplementation((fn, params) => {
      return {
        [Symbol.asyncIterator]: async function* (): AsyncGenerator<{ data: unknown[] }> {
          const response = await fn(params);
          yield { data: response.data || [] };
        }
      };
    });

    // Import the actual module after mocks are set up
    const module = await import('../scripts/sync-teams');
    syncTeams = module.syncTeams;
    runEntrypoint = module.runEntrypoint;
    parseCliArgs = module.parseCliArgs;
    parseDryRun = module.parseDryRun;
  });

  afterEach((): void => {
    // Restore environment
    process.env = { ...originalEnv };
    process.argv = [...originalArgv];
    process.exit = originalExit;

    // Clean up temp file
    try {
      unlinkSync(tempConfigPath);
    } catch (err) {
      // Ignore error if file doesn't exist
    }

    // Clear all mocks
    vi.clearAllMocks();
  });

  it('should handle protected team removal error', async (): Promise<void> => {
    mockOctokit.teams.list.mockResolvedValueOnce({
      data: [{ slug: 'protected-team', id: 1 }]
    });
    mockOctokit.teams.deleteInOrg.mockRejectedValueOnce({ status: 403 });

    writeFileSync(tempConfigPath, 'teams: []');

    await expect(syncTeams(tempConfigPath, false, testOrg)).resolves.not.toThrow();
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
        per_page: 100
      })
    );
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

  it('should handle team privacy settings correctly', async () => {
    // Set up environment
    process.env.GITHUB_TOKEN = 'test-token';
    process.env.GITHUB_REPOSITORY = 'test-org/repo';

    // Mock core functions
    vi.mocked(core.info).mockImplementation(() => {});

    // Mock team not existing initially
    mockOctokit.teams.getByName.mockRejectedValue({ status: 404 });
    mockOctokit.teams.list.mockResolvedValue({ data: [] });
    mockOctokit.teams.create.mockResolvedValue({ data: { id: 1 } });
    mockOctokit.orgs.get.mockResolvedValue({ data: {} });

    // Mock paginate iterator
    mockOctokit.paginate.iterator.mockImplementation(() => {
      return {
        [Symbol.asyncIterator]: async function* (): AsyncGenerator<{ data: unknown[] }> {
          yield { data: [] };
        }
      };
    });

    // Write simple config
    writeFileSync(tempConfigPath, `teams:
      - name: secret-team
        privacy: secret
        description: A secret team
    `);

    await syncTeams(tempConfigPath, false, 'test-org');

    // Verify team creation with correct privacy settings
    expect(mockOctokit.teams.create).toHaveBeenCalledWith({
      org: 'test-org',
      name: 'secret-team',
      description: 'A secret team',
      privacy: 'secret',
      parent_team_id: undefined,
      create_default_maintainer: false
    });
  });

  it('should throw error when config file does not exist', async (): Promise<void> => {
    const nonExistentPath = join(__dirname, 'non-existent.yaml');
    await expect(syncTeams(nonExistentPath, false, testOrg)).rejects.toThrow(
      `Config file not found at: ${nonExistentPath}`
    );
  });

  describe('runEntrypoint', () => {
    it('should handle successful execution in GitHub Action mode', async (): Promise<void> => {
      // Set up GitHub Action environment
      process.env.GITHUB_ACTION = 'true';
      process.env.GITHUB_ORG = testOrg;

      // Mock core.getInput
      vi.mocked(core.getInput).mockImplementation((name: string) => {
        if (name === 'config-path') return tempConfigPath;
        if (name === 'dry-run') return 'false';
        return '';
      });

      // Create config file
      writeFileSync(tempConfigPath, 'teams: []');

      await expect(runEntrypoint()).resolves.not.toThrow();
      expect(mockOctokit.orgs.get).toHaveBeenCalledWith({ org: testOrg });
    });

    it('should handle successful execution in CLI mode', async (): Promise<void> => {
      // Set up CLI environment
      delete process.env.GITHUB_ACTION;
      delete process.env.GITHUB_ORG;

      // Set up CLI arguments with --org
      process.argv = ['node', 'sync-teams.js', '--config', tempConfigPath, '--org', testOrg];

      // Create config file
      writeFileSync(tempConfigPath, 'teams: []');

      await expect(runEntrypoint()).resolves.not.toThrow();
      expect(mockOctokit.orgs.get).toHaveBeenCalledWith({ org: testOrg });
    });

    it('should handle --org argument in CLI mode', async (): Promise<void> => {
      // Set up CLI environment
      delete process.env.GITHUB_ACTION;
      delete process.env.GITHUB_ORG;

      // Set up CLI arguments with --org
      process.argv = ['node', 'sync-teams.js', '--config', tempConfigPath, '--org', testOrg];

      // Create config file
      writeFileSync(tempConfigPath, 'teams: []');

      await expect(runEntrypoint()).resolves.not.toThrow();
      expect(mockOctokit.orgs.get).toHaveBeenCalledWith({ org: testOrg });
    });

    it('should execute when run directly', async (): Promise<void> => {
      // Mock require.main to simulate direct execution
      Object.defineProperty(require, 'main', {
        value: { filename: __filename },
        configurable: true
      });

      // Set up GitHub Action environment
      process.env.GITHUB_ACTION = 'true';
      process.env.GITHUB_ORG = testOrg;

      // Mock core.getInput
      vi.mocked(core.getInput).mockImplementation((name: string) => {
        if (name === 'config-path') return tempConfigPath;
        if (name === 'dry-run') return 'false';
        return '';
      });

      // Create config file
      writeFileSync(tempConfigPath, 'teams: []');

      // Mock syncTeams to succeed
      const originalSyncTeams = syncTeams;
      syncTeams = vi.fn().mockResolvedValueOnce(undefined);

      try {
        await runEntrypoint();
      } finally {
        syncTeams = originalSyncTeams;
      }

      expect(mockOctokit.orgs.get).toHaveBeenCalledWith({ org: testOrg });
    });
  });

  describe('CLI and GitHub Action argument parsing', () => {
    describe('parseCliArgs', () => {
      it('should parse key-value arguments with equals sign', () => {
        const args = ['--config=test.yaml', '--org=test-org'];
        const result = parseCliArgs(args);
        expect(result).toEqual({
          '--config': 'test.yaml',
          '--org': 'test-org'
        });
      });

      it('should parse key-value arguments with space', () => {
        const args = ['--config', 'test.yaml', '--org', 'test-org'];
        const result = parseCliArgs(args);
        expect(result).toEqual({
          '--config': 'test.yaml',
          '--org': 'test-org'
        });
      });

      it('should parse flag arguments', () => {
        const args = ['--dry-run', '--config', 'test.yaml'];
        const result = parseCliArgs(args);
        expect(result).toEqual({
          '--dry-run': true,
          '--config': 'test.yaml'
        });
      });

      it('should handle empty value after equals sign', () => {
        const args = ['--dry-run=', '--config=test.yaml'];
        const result = parseCliArgs(args);
        expect(result).toEqual({
          '--dry-run': '',
          '--config': 'test.yaml'
        });
      });
    });

    describe('parseDryRun', () => {
      it('should handle boolean true', () => {
        expect(parseDryRun(true)).toBe(true);
      });

      it('should handle string "true"', () => {
        expect(parseDryRun('true')).toBe(true);
      });

      it('should handle empty string', () => {
        expect(parseDryRun('')).toBe(true);
      });

      it('should handle "=true"', () => {
        expect(parseDryRun('=true')).toBe(true);
      });

      it('should handle undefined', () => {
        expect(parseDryRun(undefined)).toBe(false);
      });

      it('should handle other values', () => {
        expect(parseDryRun('false')).toBe(false);
        expect(parseDryRun('something')).toBe(false);
      });
    });
  });
});
