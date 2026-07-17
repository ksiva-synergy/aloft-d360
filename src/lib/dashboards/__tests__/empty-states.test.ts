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
    expect(prompts).toContain('Show Total Revenue over Order Date');
  });

  it('builds breakdown + top-N prompts from a categorical dimension + measure', () => {
    const prompts = generateStarterPrompts(
      [dim('d1', 'Region', 'categorical')],
      [msr('m1', 'Total Revenue')],
    );
    expect(prompts).toContain('Break down Total Revenue by Region');
    expect(prompts).toContain('Top 10 Region by Total Revenue');
  });

  it('builds a comparison prompt when there are 2+ measures', () => {
    const prompts = generateStarterPrompts(
      [],
      [msr('m1', 'Total Revenue'), msr('m2', 'Order Count')],
    );
    expect(prompts).toContain('Compare Total Revenue vs Order Count');
  });

  it('builds a single-value prompt for one measure and no dimensions', () => {
    const prompts = generateStarterPrompts([], [msr('m1', 'Total Revenue')]);
    expect(prompts).toContain('What is the total Total Revenue?');
  });

  it('falls back to a count prompt when there is a dimension but no measure', () => {
    const prompts = generateStarterPrompts([dim('d1', 'Region', 'categorical')], []);
    expect(prompts).toEqual(['Count records by Region']);
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
    expect(WHAT_IS_THIS_DATA_PROMPT).toBe('What is this data?');
  });
});
