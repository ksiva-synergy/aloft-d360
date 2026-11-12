import {
  generateStarterPrompts,
  WHAT_IS_THIS_DATA_PROMPT,
  type StarterDimension,
  type StarterMeasure,
} from '../empty-states';

const dim = (id: string, label: string, dimension_type?: string): StarterDimension => ({ id, label, dimension_type });
const msr = (id: string, label: string): StarterMeasure => ({ id, label });

describe('generateStarterPrompts', () => {
  it('builds a trend prompt from a temporal dimension + measure', () => {
    const prompts = generateStarterPrompts(
      [dim('d1', 'Order Date', 'temporal')],
      [msr('m1', 'Total Revenue')],
    );
    expect(prompts).toContain('How has Total Revenue trended over Order Date?');
  });

  it('builds breakdown + top-N prompts from a categorical dimension + measure', () => {
    const prompts = generateStarterPrompts(
      [dim('d1', 'Region', 'categorical')],
      [msr('m1', 'Total Revenue')],
    );
    expect(prompts).toContain('Where is Total Revenue coming from — split by Region?');
    expect(prompts).toContain('Who are the top 10 Regions for Total Revenue?');
  });

  it('builds a comparison prompt when there are 2+ measures', () => {
    const prompts = generateStarterPrompts(
      [],
      [msr('m1', 'Total Revenue'), msr('m2', 'Order Count')],
    );
    expect(prompts).toContain('How does Total Revenue compare to Order Count?');
  });

  it('builds a single-value prompt for one measure and no dimensions', () => {
    const prompts = generateStarterPrompts([], [msr('m1', 'Total Revenue')]);
    expect(prompts).toContain("What's the total Total Revenue right now?");
  });

  it('falls back to a count prompt when there is a dimension but no measure', () => {
    const prompts = generateStarterPrompts([dim('d1', 'Region', 'categorical')], []);
    expect(prompts).toEqual(['How much do we have in each Region?']);
  });

  it('returns an empty array when the model has no fields', () => {
    expect(generateStarterPrompts([], [])).toEqual([]);
  });

  it('caps output at 5 prompts and is deterministic', () => {
    const dims = [
      dim('d1', 'Order Date', 'temporal'),
      dim('d2', 'Region', 'categorical'),
      dim('d3', 'Vessel', 'categorical'),
    ];
    const measures = [msr('m1', 'Revenue'), msr('m2', 'Cost'), msr('m3', 'Margin')];
    const a = generateStarterPrompts(dims, measures);
    const b = generateStarterPrompts(dims, measures);
    expect(a.length).toBeLessThanOrEqual(5);
    expect(a).toEqual(b);
  });

  it('exposes the "what is this data" spotter prompt', () => {
    expect(WHAT_IS_THIS_DATA_PROMPT).toBe(
      'Give me a plain-English tour of what I can ask about here.',
    );
  });
});
