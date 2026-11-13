import { describe, expect, it } from 'vitest';
import {
  extractTablePathsFromSql,
  pickDatabricksSourceId,
  resolveCatalogBind,
} from '@/lib/powerbi/native-sql';

describe('native-sql table paths', () => {
  it('extracts three-part paths from Spark SQL', () => {
    const sql =
      'SELECT * FROM REPORTING_LAYER.ENERVA_DBO.SYNERGYDKREPORTEDDATA WHERE YEAR(x) = 2025';
    expect(extractTablePathsFromSql(sql)).toEqual([
      'reporting_layer.enerva_dbo.synergydkreporteddata',
    ]);
  });

  it('matches databricks host to source connection_ref', () => {
    const id = pickDatabricksSourceId('adb-4626041107022307.7.azuredatabricks.net', [
      { id: 'src-1', connection_ref: 'https://adb-4626041107022307.7.azuredatabricks.net' },
    ]);
    expect(id).toBe('src-1');
  });

  it('resolveCatalogBind returns matched when one object', () => {
    const pathIndex = new Map([
      [
        'a.b.c',
        [{ id: 'obj-1', source_id: 'src-1' }],
      ],
    ]);
    const r = resolveCatalogBind({
      sql: 'SELECT 1 FROM a.b.c',
      pathIndex,
      databricksSourceId: 'src-1',
    });
    expect(r.status).toBe('matched');
    expect(r.contextObjectId).toBe('obj-1');
  });

  it('resolveCatalogBind returns unscanned when path missing', () => {
    const r = resolveCatalogBind({
      sql: 'SELECT 1 FROM x.y.z',
      pathIndex: new Map(),
      databricksSourceId: null,
    });
    expect(r.status).toBe('unscanned');
    expect(r.ucPath).toBe('x.y.z');
  });
});
