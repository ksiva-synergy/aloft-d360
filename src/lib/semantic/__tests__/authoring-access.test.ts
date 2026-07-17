import {
  decideDefinitionAccess,
  deriveIsDraft,
  isAuthoringExecution,
} from '../authoring-access';

const OWNER = 'user_owner';
const OTHER = 'user_other';
const authoring = { authoringMode: true, authoringUserId: OWNER };

describe('decideDefinitionAccess', () => {
  it('allows governed refs in authoring mode', () => {
    expect(decideDefinitionAccess({ status: 'governed', createdBy: null }, authoring)).toBe('allow');
  });

  it('allows governed refs on the default path (no opts)', () => {
    expect(decideDefinitionAccess({ status: 'governed', createdBy: null }, undefined)).toBe('allow');
  });

  it('allows candidate refs on both paths (pre-3.5A behavior preserved)', () => {
    expect(decideDefinitionAccess({ status: 'candidate', createdBy: null }, undefined)).toBe('allow');
    expect(decideDefinitionAccess({ status: 'candidate', createdBy: OTHER }, authoring)).toBe('allow');
  });

  it("allows the owner's own draft in authoring mode", () => {
    expect(decideDefinitionAccess({ status: 'draft', createdBy: OWNER }, authoring)).toBe('allow');
  });

  it("forbids another user's draft in authoring mode", () => {
    expect(decideDefinitionAccess({ status: 'draft', createdBy: OTHER }, authoring)).toBe('forbid-draft');
  });

  it('excludes any draft on the default path (no opts) — the default forbid', () => {
    expect(decideDefinitionAccess({ status: 'draft', createdBy: OWNER }, undefined)).toBe('exclude');
    expect(decideDefinitionAccess({ status: 'draft', createdBy: OTHER }, undefined)).toBe('exclude');
  });

  it('excludes drafts when authoringMode is set but authoringUserId is missing', () => {
    // authoringMode alone is not enough — it requires an owner id.
    expect(
      decideDefinitionAccess({ status: 'draft', createdBy: OWNER }, { authoringMode: true }),
    ).toBe('exclude');
  });

  it('excludes archived rows on every path', () => {
    expect(decideDefinitionAccess({ status: 'archived', createdBy: OWNER }, authoring)).toBe('exclude');
    expect(decideDefinitionAccess({ status: 'archived', createdBy: null }, undefined)).toBe('exclude');
  });
});

describe('isAuthoringExecution', () => {
  it('is true only with both authoringMode and authoringUserId', () => {
    expect(isAuthoringExecution({ authoringMode: true, authoringUserId: OWNER })).toBe(true);
    expect(isAuthoringExecution({ authoringMode: true })).toBe(false);
    expect(isAuthoringExecution({ authoringUserId: OWNER })).toBe(false);
    expect(isAuthoringExecution(undefined)).toBe(false);
  });
});

describe('deriveIsDraft', () => {
  it('is false for any non-authoring (default) execution', () => {
    expect(deriveIsDraft(['candidate', 'draft'], false)).toBe(false);
    expect(deriveIsDraft(['governed'], false)).toBe(false);
  });

  it('is false when all referenced defs are governed, even in authoring mode', () => {
    expect(deriveIsDraft(['governed', 'governed'], true)).toBe(false);
  });

  it('is true for a mixed governed + own-draft authoring execution', () => {
    expect(deriveIsDraft(['governed', 'draft'], true)).toBe(true);
  });

  it('is true when a candidate is referenced in authoring mode', () => {
    expect(deriveIsDraft(['candidate'], true)).toBe(true);
  });
});
