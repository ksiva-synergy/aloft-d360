import { describe, expect, it } from 'vitest';
import { ESTATE_OBJECTS_BY_SOURCE_SQL } from './estate-source-sql';

describe('estate-source-sql', () => {
  it('documents text source_id predicate for platform_estate_objects', () => {
    expect(ESTATE_OBJECTS_BY_SOURCE_SQL).toBe('source_id = $2');
  });
});
