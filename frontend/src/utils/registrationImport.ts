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
  const firstLine = source.split(/\r?\n/).find(line => line.trim()) ?? '';
  const separator = ['\t', ',', '，', ';', '；'].find(value => firstLine.includes(value));
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
  const headers = records[0]?.cells ?? [];
  const numberColumns = headers.flatMap((value, i) => headerMatches(value, 'studentNo') ? [i] : []);
  const nameColumns = headers.flatMap((value, i) => headerMatches(value, 'name') ? [i] : []);
  const hasHeader = numberColumns.length > 0 || nameColumns.length > 0;
  if (hasHeader && (numberColumns.length !== 1 || nameColumns.length !== 1)) {
    return { entries: [], rows: [], errors: ['表头无法唯一识别学号和姓名，请分别标注“学号”和“姓名”，并去除重复列名。'] };
  }
  const rows = (hasHeader ? records.slice(1) : records).map(record => {
    let numberIndex = numberColumns[0], nameIndex = nameColumns[0];
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
    const error = !studentNo || !name ? '学号或姓名为空。' : studentNo.length > 32 || name.length > 64 ? '学号或姓名超出长度限制。' : /^\d+(?:\.\d+)?e[+-]?\d+$/i.test(studentNo) ? '学号为科学计数法，请从原表复制完整文本学号。' : '';
    return { line: record.line, studentNo, name, error };
  });
  return {
    rows,
    entries: rows.filter(row => !row.error).map(({ studentNo, name }) => ({ studentNo, name })),
    errors: rows.filter(row => row.error).map(row => `第 ${row.line} 行：${row.error}`),
  };
}
