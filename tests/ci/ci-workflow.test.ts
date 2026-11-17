import * as fs from 'fs';
import * as path from 'path';

const WORKFLOW_PATH = path.join(__dirname, '../../.github/workflows/ci.yml');

/** Lee el workflow sin comentarios; falla con un mensaje claro si no existe. */
function loadWorkflow(): string {
  if (!fs.existsSync(WORKFLOW_PATH)) {
    throw new Error(
      'Falta el workflow .github/workflows/ci.yml (SCRUM-43): aún no está implementado.',
    );
  }
  return fs
    .readFileSync(WORKFLOW_PATH, 'utf8')
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((l) => l.replace(/^\s*#.*$/, '').replace(/\s+#.*$/, ''))
    .join('\n');
}

/** Bloque de un job: desde `  <id>:` hasta la siguiente clave de job (2 espacios) o de nivel superior. */
function jobBlock(text: string, id: string): string {
  const lines = text.split('\n');
  const start = lines.findIndex((l) => new RegExp(`^ {2}${id}:\\s*$`).test(l));
  if (start === -1) {
    throw new Error(`No se encontró el job "${id}" en ci.yml`);
  }
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (/^ {2}[A-Za-z0-9_-]+:\s*$/.test(lines[i]) || /^\S/.test(lines[i])) {
      end = i;
      break;
    }
  }
  return lines.slice(start, end).join('\n');
}

/** Bloque de una clave de nivel superior (`on:`, `concurrency:`...). */
function topBlock(text: string, key: string): string {
  const lines = text.split('\n');
  const start = lines.findIndex((l) => new RegExp(`^${key}:`).test(l));
  if (start === -1) {
    throw new Error(`No se encontró la clave de nivel superior "${key}" en ci.yml`);
  }
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (/^\S/.test(lines[i])) {
      end = i;
      break;
    }
  }
  return lines.slice(start, end).join('\n');
}

/** Extrae los nombres de rama de `branches:` en forma inline o de lista. */
function branchesOf(block: string): string[] {
  const inline = block.match(/branches:\s*\[([^\]]*)\]/);
  if (inline) {
    return inline[1]
      .split(',')
      .map((s) => s.trim().replace(/^['"]|['"]$/g, ''))
      .filter(Boolean);
  }
  const lines = block.split('\n');
  const idx = lines.findIndex((l) => /^\s*branches:\s*$/.test(l));
  if (idx === -1) return [];
  const result: string[] = [];
  for (let i = idx + 1; i < lines.length; i++) {
    const m = lines[i].match(/^\s*-\s*['"]?([^'"\s]+)['"]?\s*$/);
    if (!m) break;
    result.push(m[1]);
  }
  return result;
}

const runRe = (cmd: string): RegExp =>
  new RegExp(`^\\s*(?:-\\s*)?run:\\s*['"]?${cmd}['"]?\\s*$`, 'gm');

const countRun = (block: string, cmd: string): number => (block.match(runRe(cmd)) ?? []).length;

const indexRun = (block: string, cmd: string): number => {
  const m = runRe(cmd).exec(block);
  return m ? m.index : -1;
};

const FORBIDDEN: Array<[string, RegExp]> = [
  ['continue-on-error', /continue-on-error/],
  ['|| true', /\|\|\s*true/],
  ['if: always()', /if:\s*['"]?\$?\{?\{?\s*always\(\)/],
  ['if: failure()', /if:\s*['"]?\$?\{?\{?\s*failure\(\)/],
];

describe('Workflow de CI (.github/workflows/ci.yml)', () => {
  it('existe el archivo del workflow', () => {
    expect(fs.existsSync(WORKFLOW_PATH)).toBe(true);
  });

  describe('CA-1: se dispara en cada Pull Request hacia develop y main', () => {
    it('CA-1: el workflow se llama CI', () => {
      expect(loadWorkflow()).toMatch(/^name:\s*['"]?CI['"]?\s*$/m);
    });

    it('CA-1: el disparador es pull_request', () => {
      expect(topBlock(loadWorkflow(), 'on')).toMatch(/^\s+pull_request:/m);
    });

    it('CA-1: las ramas objetivo son exactamente develop y main', () => {
      const branches = branchesOf(topBlock(loadWorkflow(), 'on'));
      expect([...branches].sort()).toEqual(['develop', 'main']);
    });

    it('CA-1: no hay otros disparadores ni filtros que limiten (push, paths, branches-ignore)', () => {
      const on = topBlock(loadWorkflow(), 'on');
      expect(on).not.toMatch(/^\s+push:/m);
      expect(on).not.toMatch(/paths(-ignore)?:/);
      expect(on).not.toMatch(/branches-ignore:/);
      expect(on).not.toMatch(/^\s+pull_request_target:/m);
    });
  });

  describe('CA-2: ejecuta en orden npm ci, npm test, npm run lint y npm run build', () => {
    const cmds = ['npm ci', 'npm test', 'npm run lint', 'npm run build'];

    it.each(cmds)('CA-2: "%s" aparece exactamente una vez en build-and-test', (cmd) => {
      const job = jobBlock(loadWorkflow(), 'build-and-test');
      expect(countRun(job, cmd)).toBe(1);
    });

    it('CA-2: los cuatro comandos van en orden creciente', () => {
      const job = jobBlock(loadWorkflow(), 'build-and-test');
      const idx = cmds.map((c) => indexRun(job, c));
      idx.forEach((i) => expect(i).toBeGreaterThanOrEqual(0));
      expect([...idx].sort((a, b) => a - b)).toEqual(idx);
      expect(new Set(idx).size).toBe(4);
    });

    it('CA-2: checkout y setup-node (Node 22, cache npm) preceden a npm ci', () => {
      const job = jobBlock(loadWorkflow(), 'build-and-test');
      const checkout = job.search(/uses:\s*actions\/checkout@v4/);
      const setup = job.search(/uses:\s*actions\/setup-node@v4/);
      const ci = indexRun(job, 'npm ci');
      expect(checkout).toBeGreaterThanOrEqual(0);
      expect(setup).toBeGreaterThan(checkout);
      expect(ci).toBeGreaterThan(setup);
      expect(job).toMatch(/node-version:\s*['"]?22(\.x)?['"]?\s*$/m);
      expect(job).toMatch(/cache:\s*['"]?npm['"]?\s*$/m);
    });

    it('CA-2: un comando por paso (sin encadenar con && o ;)', () => {
      const job = jobBlock(loadWorkflow(), 'build-and-test');
      const runs = job.match(/^\s*(?:-\s*)?run:.*$/gm) ?? [];
      expect(runs).toHaveLength(4);
      runs.forEach((r) => expect(r).not.toMatch(/&&|;|\|\|/));
    });
  });

  describe('CA-3: si cualquier paso falla, el check queda en rojo', () => {
    it.each(['build-and-test', 'e2e'])('CA-3: el job %s no enmascara fallos', (id) => {
      const job = jobBlock(loadWorkflow(), id);
      for (const [, re] of FORBIDDEN) {
        expect(job).not.toMatch(re);
      }
    });

    it('CA-3: ningún punto del archivo enmascara fallos', () => {
      const text = loadWorkflow();
      for (const [, re] of FORBIDDEN) {
        expect(text).not.toMatch(re);
      }
    });
  });

  describe('CA-4: nombre estable del check requerido', () => {
    it('CA-4: el job build-and-test se llama "CI / build-and-test"', () => {
      const job = jobBlock(loadWorkflow(), 'build-and-test');
      expect(job).toMatch(/^\s+name:\s*['"]?CI \/ build-and-test['"]?\s*$/m);
    });
  });

  describe('Configuración del job build-and-test', () => {
    it('usa ubuntu-latest, timeout y permisos de solo lectura', () => {
      const job = jobBlock(loadWorkflow(), 'build-and-test');
      expect(job).toMatch(/runs-on:\s*ubuntu-latest\s*$/m);
      expect(job).toMatch(/timeout-minutes:\s*\d+\s*$/m);
      expect(job).toMatch(/permissions:\s*\n\s+contents:\s*read\s*$/m);
    });

    it('no depende de e2e', () => {
      const job = jobBlock(loadWorkflow(), 'build-and-test');
      expect(job).not.toMatch(/needs:/);
    });
  });

  describe('Concurrencia', () => {
    it('agrupa por ref y cancela ejecuciones en curso', () => {
      const block = topBlock(loadWorkflow(), 'concurrency');
      expect(block).toMatch(/group:\s*['"]?ci-\$\{\{\s*github\.ref\s*\}\}['"]?\s*$/m);
      expect(block).toMatch(/cancel-in-progress:\s*true\s*$/m);
    });
  });

  describe('Job e2e independiente', () => {
    it('se llama "CI / e2e", sin needs, con permisos y timeout', () => {
      const job = jobBlock(loadWorkflow(), 'e2e');
      expect(job).toMatch(/^\s+name:\s*['"]?CI \/ e2e['"]?\s*$/m);
      expect(job).not.toMatch(/needs:/);
      expect(job).toMatch(/runs-on:\s*ubuntu-latest\s*$/m);
      expect(job).toMatch(/timeout-minutes:\s*\d+\s*$/m);
      expect(job).toMatch(/permissions:\s*\n\s+contents:\s*read\s*$/m);
    });

    it('instala chromium antes de ejecutar playwright test, tras npm ci', () => {
      const job = jobBlock(loadWorkflow(), 'e2e');
      const ci = indexRun(job, 'npm ci');
      const install = indexRun(job, 'npx playwright install --with-deps chromium');
      const run = indexRun(job, 'npx playwright test');
      expect(ci).toBeGreaterThanOrEqual(0);
      expect(install).toBeGreaterThan(ci);
      expect(run).toBeGreaterThan(install);
      expect(countRun(job, 'npx playwright test')).toBe(1);
    });

    it('usa checkout y setup-node (Node 22, cache npm)', () => {
      const job = jobBlock(loadWorkflow(), 'e2e');
      expect(job).toMatch(/uses:\s*actions\/checkout@v4/);
      expect(job).toMatch(/uses:\s*actions\/setup-node@v4/);
      expect(job).toMatch(/node-version:\s*['"]?22(\.x)?['"]?\s*$/m);
      expect(job).toMatch(/cache:\s*['"]?npm['"]?\s*$/m);
    });
  });

  describe('Actions fijadas', () => {
    it('todas las actions usan la etiqueta mayor @v4', () => {
      const text = loadWorkflow();
      const uses = text.match(/uses:\s*\S+/g) ?? [];
      expect(uses.length).toBeGreaterThanOrEqual(4);
      uses.forEach((u) => expect(u).toMatch(/@v4$/));
    });
  });
});
