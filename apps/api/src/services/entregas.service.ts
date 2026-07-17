import fs from 'fs';
import path from 'path';

const ENTREGAS_DIR = path.join(process.cwd(), 'content', 'entregas');

export interface Entrega {
  title: string;
  date: string;
  modulo: string;
  body: string;
}

// Faz parse de um arquivo .md com frontmatter simples:
// ---
// chave: valor
// ---
// corpo...
function parseEntregaFile(raw: string): Entrega {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);

  if (!match) {
    return { title: 'Sem titulo', date: '', modulo: '', body: raw.trim() };
  }

  const [, frontmatter, body] = match;
  const fields: Record<string, string> = {};

  for (const line of frontmatter.split(/\r?\n/)) {
    const sep = line.indexOf(':');
    if (sep === -1) continue;
    const key = line.slice(0, sep).trim();
    const value = line.slice(sep + 1).trim();
    fields[key] = value;
  }

  return {
    title: fields.title || 'Sem titulo',
    date: fields.date || '',
    modulo: fields.modulo || '',
    body: body.trim(),
  };
}

export function getEntregas(): Entrega[] {
  if (!fs.existsSync(ENTREGAS_DIR)) {
    return [];
  }

  const files = fs.readdirSync(ENTREGAS_DIR).filter(f => f.endsWith('.md'));

  const entregas = files.map(file => {
    const raw = fs.readFileSync(path.join(ENTREGAS_DIR, file), 'utf-8');
    return parseEntregaFile(raw);
  });

  return entregas.sort((a, b) => b.date.localeCompare(a.date));
}
