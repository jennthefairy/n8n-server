const BASE_URL = `https://api.airtable.com/v0/${process.env.AIRTABLE_BASE_ID}`;

function headers() {
  return {
    Authorization: `Bearer ${process.env.AIRTABLE_TOKEN}`,
    'Content-Type': 'application/json',
  };
}

export function sanitizeParam(input: string): string {
  return input.replace(/['"\\]/g, '').slice(0, 64);
}

export async function airtableFetch(
  table: string,
  options: { filterByFormula?: string; maxRecords?: number } = {}
): Promise<any> {
  const params = new URLSearchParams();
  if (options.filterByFormula) params.set('filterByFormula', options.filterByFormula);
  if (options.maxRecords) params.set('maxRecords', options.maxRecords.toString());

  const url = params.toString()
    ? `${BASE_URL}/${table}?${params}`
    : `${BASE_URL}/${table}`;

  const res = await fetch(url, { headers: headers() });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Airtable error: ${res.status} - ${body}`);
  }
  return res.json();
}

export async function airtableGetRecord(table: string, recordId: string): Promise<any> {
  const res = await fetch(`${BASE_URL}/${table}/${recordId}`, {
    headers: headers(),
  });
  if (!res.ok) return null;
  return res.json();
}

export async function airtableCreate(table: string, fields: Record<string, unknown>): Promise<any> {
  const res = await fetch(`${BASE_URL}/${table}`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({ records: [{ fields }] }),
  });
  return res.json();
}

export async function airtableUpdate(
  table: string,
  recordId: string,
  fields: Record<string, unknown>
): Promise<any> {
  const res = await fetch(`${BASE_URL}/${table}/${recordId}`, {
    method: 'PATCH',
    headers: headers(),
    body: JSON.stringify({ fields }),
  });
  return res.json();
}
