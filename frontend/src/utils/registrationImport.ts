import { readRosterRows } from './roster';

export type RegistrationEntry = { studentNo: string; name: string };
export type RegistrationImport = {
  entries: RegistrationEntry[];
  rows: { line: number; studentNo: string; name: string; error: string }[];
  errors: string[];
};

const aliases = {
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
    return cells.some(value => headerMatches(value, 'studentNo')) && cells.some(value => headerMatches(value, 'name'));
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
  if (quoted) return { entries: [], rows: [], errors: [`第 ${startLine} 行：CSV 引号未闭合`] };
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

function parseRecords(records: { line: number; cells: string[] }[]): RegistrationImport {
  const candidates = records.flatMap((record, index) => {
    const numbers = record.cells.flatMap((value, i) => headerMatches(value, 'studentNo') ? [i] : []);
    const names = record.cells.flatMap((value, i) => headerMatches(value, 'name') ? [i] : []);
    return numbers.length && names.length ? [{ index, line: record.line, numbers, names }] : [];
  });
  if (candidates.length > 1) return { entries: [], rows: [], errors: [`第 ${candidates.map(row => row.line).join('、')} 行存在多个候选表头，请仅保留一张名单表。`] };
  const header = candidates[0];
  if (header && (header.numbers.length !== 1 || header.names.length !== 1)) {
    return { entries: [], rows: [], errors: [`第 ${header.line} 行表头无法唯一识别学号和姓名，请去除重复列名。`] };
  }
  const hasHeader = !!header;
  const rows = (header ? records.slice(header.index + 1) : records).map(record => {
    let numberIndex = header?.numbers[0] ?? -1, nameIndex = header?.names[0] ?? -1;
    if (!hasHeader) {
      // Without headers, only infer unambiguous numeric IDs and Chinese names.
      const numbers = record.cells.flatMap((value, i) => /^\d{4,32}$/.test(value) ? [i] : []);
      const names = record.cells.flatMap((value, i) => /^[\u3400-\u9fff]{2,8}(?:[·•][\u3400-\u9fff]{1,8})*$/.test(value) ? [i] : []);
      if (numbers.length !== 1 || names.length !== 1) {
        return { line: record.line, studentNo: '', name: '', error: '无法唯一判断学号和姓名，请补充表头或修正本行。' };
      }
      numberIndex = numbers[0]; nameIndex = names[0];
    }
    const studentNo = record.cells[numberIndex] ?? '', name = record.cells[nameIndex] ?? '';
    const error = studentNo.startsWith('[数值精度异常') ? '学号数值精度异常，请将原表学号设为文本并核对完整号码。' : !studentNo || !name ? '学号或姓名为空。' : studentNo.length > 32 || name.length > 64 ? '学号或姓名超出长度限制。' : /^\d+(?:\.\d+)?e[+-]?\d+$/i.test(studentNo) ? '学号为科学计数法，请从原表复制完整文本学号。' : '';
    return { line: record.line, studentNo, name, error };
  });
  return {
    rows,
    entries: rows.filter(row => !row.error).map(({ studentNo, name }) => ({ studentNo, name })),
    errors: rows.filter(row => row.error).map(row => `第 ${row.line} 行：${row.error}`),
  };
}
