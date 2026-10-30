import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router';
import '@/app/globals.css';
import { StreamingMessage } from '@/components/workbench/StreamingMessage';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

const md = `# Fleet fuel cost summary

The three vessels with the highest bunker spend in **Q3** are shown below. The analysis uses the governed \`fact_bunker_consumption\` model and excludes ballast legs.

## Key findings

- MV Nordic Courageous Explorer of the Northern Seas consumed 1,234,567.89 MT of fuel, the largest share
- Average price per tonne rose 8.4% quarter over quarter
- Two vessels breached the voyage budget variance threshold

### Recommended next steps

1. Review the three flagged voyages with the commercial team before month end
2. Re-run the forecast with updated bunker price assumptions

> Note: figures exclude port-stay consumption and are rounded to two decimals.

\`\`\`sql
SELECT vessel_name, SUM(fuel_mt) AS total_fuel_mt
FROM gold.fact_bunker_consumption
WHERE quarter = '2026-Q3'
GROUP BY vessel_name
ORDER BY total_fuel_mt DESC
LIMIT 10;
\`\`\`
`;

const toolCalls = [
  { callId: 'c1', toolId: 'run_sql', toolName: 'run_databricks_sql', status: 'success' as const, input: { sql: 'SELECT 1' }, output: { rows: 3 }, durationMs: 1342 },
  { callId: 'c2', toolId: 'describe', toolName: 'describe_table', status: 'error' as const, error: 'Table not found: gold.fact_unknown', durationMs: 220 },
];

const long = 'Maersk Eindhoven Ultra Large Container Vessel — Pacific Gulf Carrier Holdings (Singapore) Pte Ltd';

function App() {
  return (
    <div style={{ maxWidth: 860, margin: '0 auto', padding: 24, display: 'flex', flexDirection: 'column', gap: 32 }}>
      <StreamingMessage content={md} isStreaming={false} toolCalls={toolCalls} timestamp={Date.now()} durationMs={4210} tokenCount={1832} modelName="claude-opus-5-5" />
      <div style={{ overflowX: 'auto' }}>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Vessel</TableHead>
              <TableHead>Operator</TableHead>
              <TableHead className="text-right">Fuel (MT)</TableHead>
              <TableHead className="text-right">Cost (USD)</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {[1, 2, 3].map((i) => (
              <TableRow key={i}>
                <TableCell>{long}</TableCell>
                <TableCell>Operator {i}</TableCell>
                <TableCell className="text-right tnum">{(1234567.89 * i).toLocaleString()}</TableCell>
                <TableCell className="text-right tnum">{(98765432.1 * i).toLocaleString()}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <h1 className="type-title-page">Page title — {long}</h1>
      <p className="type-body-lg">Body large paragraph with a long run of text to check line height and measure. Inter at sixteen pixels should be comfortable for AI generated explanations over several lines of copy.</p>
      <div className="flex gap-4">
        <div className="type-kpi-lg">12,345,678</div>
        <div className="type-kpi-md">9,876,543.21</div>
        <div className="type-kpi-sm">1,111</div>
        <code className="type-code-inline">gold.fact_bunker_consumption.vessel_name</code>
      </div>
    </div>
  );
}
createRoot(document.getElementById('root')!).render(<MemoryRouter><App /></MemoryRouter>);
