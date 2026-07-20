import {
  buildLineageGraph,
  coReferencedMeasures,
  compiledSqlForMeasure,
  estateNodeId,
  dimNodeId,
  measNodeId,
  consumerNodeId,
  type LoadedCatalog,
  type ConsumerLink,
  type DefNode,
} from '../lineage';

// ── Fixture: two tables, one join, gov + candidate defs, one dashboard ────────
function makeCatalog(overrides: Partial<LoadedCatalog> = {}): LoadedCatalog {
  return {
    model: { id: 'model1', name: 'Fleet', status: 'governed' },
    entities: [
      { id: 'ent_voyage', full_path: 'lake.voyage.emissions', entity_label: 'Emissions',
        description: null, ai_context: null, synonyms: [], status: 'governed' },
      { id: 'ent_reg', full_path: 'lake.registry.registration', entity_label: 'Registration',
        description: null, ai_context: null, synonyms: [], status: 'governed' },
    ],
    dimensions: [
      { id: 'dim_flag', entity_id: 'ent_reg', column_name: 'flag_state', dimension_label: 'Flag State',
        dimension_type: 'categorical', description: null, ai_context: null, synonyms: ['flag'],
        format_hint: null, status: 'governed' },
      { id: 'dim_port', entity_id: 'ent_voyage', column_name: 'port_call_unlocode', dimension_label: 'Port',
        dimension_type: 'categorical', description: null, ai_context: null, synonyms: [],
        format_hint: null, status: 'candidate' }, // ← candidate dimension
    ],
    measures: [
      { id: 'meas_co2', entity_id: 'ent_voyage', column_name: 'co2_emissions_t', measure_label: 'CO2 Emissions',
        aggregate: 'sum', expression: null, metric_type: 'simple', description: null, ai_context: null,
        synonyms: [], unit: 't', format_hint: null, status: 'governed' },
    ],
    joins: [
      { id: 'j1', from_entity_id: 'ent_voyage', to_entity_id: 'ent_reg', join_type: 'inner',
        join_on_sql: 'a.imo_number = b.imo_number' },
    ],
    ...overrides,
  };
}

// A dashboard whose widget references BOTH meas_co2 and the candidate dim_port.
function makeConsumers(): ConsumerLink[] {
  return [
    {
      dashboardId: 'dash1',
      name: 'Port Emissions',
      visibility: 'org',
      modelGoverned: true,
      dimensionIds: new Set(['dim_port']),
      measureIds: new Set(['meas_co2']),
    },
  ];
}

describe('coReferencedMeasures (reverse lens — Pin #2)', () => {
  it('returns measures co-referenced with a dimension in the same widget', () => {
    const consumers = makeConsumers();
    expect([...coReferencedMeasures('dim_port', consumers)]).toEqual(['meas_co2']);
  });
  it('is empty for a dimension no widget references', () => {
    expect([...coReferencedMeasures('dim_flag', makeConsumers())]).toEqual([]);
  });
});

describe('buildLineageGraph', () => {
  const graph = buildLineageGraph(makeCatalog(), makeConsumers());

  it('emits estate/dimension/measure/consumer nodes', () => {
    const kinds = graph.nodes.reduce<Record<string, number>>((acc, n) => {
      acc[n.kind] = (acc[n.kind] ?? 0) + 1;
      return acc;
    }, {});
    expect(kinds).toEqual({ estate: 2, dimension: 2, measure: 1, consumer: 1 });
  });

  it('carries join keys on the join edge (Pin #2)', () => {
    const joinEdge = graph.edges.find((e) => e.kind === 'join');
    expect(joinEdge).toBeDefined();
    expect(joinEdge!.joinKeys).toBe('a.imo_number = b.imo_number');
    expect(joinEdge!.from).toBe(estateNodeId('ent_voyage'));
    expect(joinEdge!.to).toBe(estateNodeId('ent_reg'));
  });

  it('links each def to its estate table via a membership edge', () => {
    const flagMembership = graph.edges.find(
      (e) => e.kind === 'membership' && e.to === dimNodeId('dim_flag'),
    );
    expect(flagMembership!.from).toBe(estateNodeId('ent_reg'));
  });

  it('FORWARD: def→consumer consumes edges (same read as reverse)', () => {
    const consumesTargets = graph.edges
      .filter((e) => e.kind === 'consumes')
      .map((e) => `${e.from}->${e.to}`)
      .sort();
    expect(consumesTargets).toEqual(
      [
        `${dimNodeId('dim_port')}->${consumerNodeId('dash1')}`,
        `${measNodeId('meas_co2')}->${consumerNodeId('dash1')}`,
      ].sort(),
    );
  });

  it('resolvesTo uses full_path + real column, and a SEPARATE toAlias result key (trap b)', () => {
    const co2 = graph.nodes.find((n) => n.id === measNodeId('meas_co2')) as DefNode;
    expect(co2.resolvesTo.fullPath).toBe('lake.voyage.emissions');
    expect(co2.resolvesTo.column).toBe('co2_emissions_t'); // the source field
    expect(co2.resolvesTo.resultAlias).toBe('co2_emissions'); // toAlias(label) — the row key
    expect(co2.resolvesTo.column).not.toBe(co2.resolvesTo.resultAlias);
  });

  it('CANDIDATE PROPAGATION (Pin #3): a governed metric is capped by a co-referenced candidate dim', () => {
    const co2 = graph.nodes.find((n) => n.id === measNodeId('meas_co2')) as DefNode;
    expect(co2.status).toBe('governed');
    expect(co2.capped).toBe(true);
    expect(co2.cappedBy).toContain(dimNodeId('dim_port')); // the candidate dimension
  });

  it('a metric with no candidate in its chain is NOT capped', () => {
    // no candidate dims anywhere
    const cleanCat = makeCatalog({
      dimensions: [
        { id: 'dim_flag', entity_id: 'ent_reg', column_name: 'flag_state', dimension_label: 'Flag State',
          dimension_type: 'categorical', description: null, ai_context: null, synonyms: [],
          format_hint: null, status: 'governed' },
      ],
    });
    const g = buildLineageGraph(cleanCat, []);
    const co2 = g.nodes.find((n) => n.id === measNodeId('meas_co2')) as DefNode;
    expect(co2.capped).toBeFalsy();
  });

  it('surfaces honest omissions as a first-class contract shape ({field, reason})', () => {
    expect(graph.omissions.length).toBeGreaterThan(0);
    // Contract-level absence: every omission is a typed {field, reason}, not prose.
    for (const o of graph.omissions) {
      expect(typeof o.field).toBe('string');
      expect(typeof o.reason).toBe('string');
    }
    // SCD (no backing field on any platform_sem_* table) is named explicitly.
    expect(graph.omissions.some((o) => /scd/i.test(o.field))).toBe(true);
  });
});

describe('compiledSqlForMeasure (trust-spine peek — PURE, Pin #1)', () => {
  it('compiles real full_path + aggregate over the source column', () => {
    const sql = compiledSqlForMeasure(makeCatalog(), 'meas_co2');
    expect(sql).toBeTruthy();
    expect(sql!).toContain('lake.voyage.emissions'); // real table
    expect(sql!).toContain('SUM(co2_emissions_t)'); // aggregate over real field
    expect(sql!).toContain('AS co2_emissions'); // toAlias key
  });

  it('returns null (explicit, not a throw) for an unknown measure', () => {
    expect(compiledSqlForMeasure(makeCatalog(), 'nope')).toBeNull();
  });
});
