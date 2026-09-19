import { readRosterRows } from './roster';

export type RegistrationEntry = { className: string; studentNo: string; name: string };
export type RegistrationField = keyof RegistrationEntry;
export type RegistrationColumns = Record<RegistrationField, number>;
export type RegistrationRecord = { line: number; cells: string[] };
export type RegistrationImport = {
  records: RegistrationRecord[];
  headerIndex: number;
  columns: RegistrationColumns;
  needsMapping: boolean;
  rows: (RegistrationEntry & { line: number })[];
  errors: string[];
};
export const registrationFields: RegistrationField[] = ['className', 'studentNo', 'name'];
export const registrationLabels: Record<RegistrationField, string> = { className: '班级', studentNo: '学号', name: '姓名' };
const emptyColumns: RegistrationColumns = { className: -1, studentNo: -1, name: -1 };
const aliases = {
  className: ['班级', '行政班', '行政班级', '专业班级', '所在班级', '班别', 'class', 'classname'],
  studentNo: ['学号', '学生编号', '学生账号', '学籍号', 'studentno', 'studentnumber', 'studentid'],
  name: ['姓名', '学生名字', '学生名称', 'name', 'studentname', 'fullname'],
};
const normalizeHeader = (value: string) => value.normalize('NFKC').toLowerCase().replace(/[\s_\-:：()（）*]/g, '');
function headerMatches(value: string, field: keyof typeof aliases) {
  const header = normalizeHeader(value);
  return aliases[field].some(alias => header === alias || (/[\u3400-\u9fff]/.test(alias) && (header === `学生${alias}` || header === `${alias}必填`)));
}

export function parseRegistrationImport(text: string): RegistrationImport {
  const source = text.replace(/^\uFEFF/, '');
  // Titles may precede the table. Prefer the delimiter that exposes a header,
  // otherwise use the one occurring on the most physical lines.
  const lines = source.split(/\r?\n/);
  const separators = ['\t', ',', '，', ';', '；'];
  const headerSeparator = separators.find(separator => lines.some(line => {
    const cells = line.split(separator).map(value => value.trim().replace(/^"|"$/g, ''));
    return registrationFields.filter(field => cells.some(value => headerMatches(value, field))).length >= 2;
  }));
  const ranked = separators.map(value => ({ value, count: lines.filter(line => line.includes(value)).length })).sort((a, b) => b.count - a.count);
  const separator = headerSeparator ?? (ranked[0].count ? ranked[0].value : undefined);
  const records: { line: number; cells: string[] }[] = [];
  let cells: string[] = [], field = '', quoted = false, line = 1, startLine = 1;
  const endField = () => { cells.push(field.trim()); field = ''; };
  const endRow = () => {
    endField();
    if (cells.some(Boolean)) records.push({ line: startLine, cells });
    cells = [];
  };
  for (let i = 0; i < source.length; i++) {
    const c = source[i];
    if (c === '"') {
      if (quoted && source[i + 1] === '"') { field += '"'; i++; }
      else quoted = !quoted;
    } else if (!quoted && (c === '\n' || c === '\r')) {
      if (c === '\r' && source[i + 1] === '\n') i++;
      endRow(); line++; startLine = line;
    } else if (!quoted && (separator ? c === separator : /[^\S\r\n]/.test(c))) {
      if (separator || field) endField();
    } else { field += c; if (c === '\n') line++; }
  }
  if (quoted) throw new Error(`第 ${startLine} 行：CSV 引号未闭合`);
  endRow();
  return parseRecords(records);
}

export async function parseRegistrationFile(file: File): Promise<RegistrationImport> {
  if (/\.csv$/i.test(file.name)) return parseRegistrationImport(await file.text());
  if (/\.xls$/i.test(file.name)) throw new Error('旧版 .xls 文件请先另存为 .xlsx 后上传。');
  if (!/\.xlsx$/i.test(file.name)) throw new Error('请上传 .xlsx 或 .csv 文件。');
  const rows = await readRosterRows(file);
  return parseRecords(rows.map((cells, i) => ({
    line: i + 1,
    cells: cells.map(value => typeof value === 'number' && !Number.isSafeInteger(value) ? '[数值精度异常，请将学号设为文本]' : String(value ?? '').trim()),
  })).filter(row => row.cells.some(Boolean)));
}

export function mapRegistrationRecords(records: RegistrationRecord[], headerIndex: number, columns: RegistrationColumns): RegistrationImport {
  const selected = registrationFields.map(field => columns[field]).filter(index => index >= 0);
  const errors = selected.length !== new Set(selected).size ? ['同一列不能同时对应多个字段。'] : [];
  const rows = records.slice(headerIndex + 1).map(record => ({
    line: record.line,
    className: record.cells[columns.className] ?? '',
    studentNo: record.cells[columns.studentNo] ?? '',
    name: record.cells[columns.name] ?? '',
  }));
  return { records, headerIndex, columns, needsMapping: false, rows, errors };
}

function parseRecords(records: RegistrationRecord[]): RegistrationImport {
  const candidates = records.flatMap((record, index) => {
    const matches = Object.fromEntries(registrationFields.map(field => [field, record.cells.flatMap((value, i) => headerMatches(value, field) ? [i] : [])])) as Record<RegistrationField, number[]>;
    const score = registrationFields.filter(field => matches[field].length).length;
    return score ? [{ index, matches, score }] : [];
  });
  const bestScore = Math.max(0, ...candidates.map(candidate => candidate.score));
  const best = candidates.filter(candidate => candidate.score === bestScore);
  const header = best[0];
  const columns = { ...emptyColumns };
  let needsMapping = best.length > 1;
  if (header) {
    for (const field of registrationFields) {
      columns[field] = header.matches[field].length === 1 ? header.matches[field][0] : -1;
      if (header.matches[field].length > 1) needsMapping = true;
    }
  } else {
    const width = records.reduce((max, row) => Math.max(max, row.cells.length), 0);
    const looksLike: Record<RegistrationField, (value: string) => boolean> = {
      className: value => /班/.test(value),
      studentNo: value => /^\d{4,32}$/.test(value),
      name: value => !/班/.test(value) && /^[\u3400-\u9fff]{2,8}(?:[·•][\u3400-\u9fff]{1,8})*$/.test(value),
    };
    for (const field of registrationFields) {
      const candidates = Array.from({ length: width }, (_, i) => i).filter(i => {
        const values = records.map(row => row.cells[i] ?? '').filter(Boolean);
        return values.length > 0 && values.every(looksLike[field]);
      });
      columns[field] = candidates.length === 1 ? candidates[0] : -1;
      if (candidates.length > 1) needsMapping = true;
    }
    if (registrationFields.every(field => columns[field] === -1)) needsMapping = true;
  }
  const result = mapRegistrationRecords(records, header?.index ?? -1, columns);
  return { ...result, needsMapping: needsMapping || result.errors.length > 0 };
}
