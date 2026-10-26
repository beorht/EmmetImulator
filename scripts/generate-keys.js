import { randomInt } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DATA_DIR, normalizeKey, readJson, writeJson } from '../server/store.js';

/**
 * Выдаёт ключи входа по списку группы server/data/roster.txt (одно ФИО в строке).
 * Ключ студента — stWeb-### из трёх случайных цифр, ключ преподавателя — ADM-XXXX-XXXX.
 * Уже выданные ключи не меняются: скрипт можно запускать повторно, когда в группу добавляются студенты.
 * Ключи студентов старого формата заменяются новыми.
 * Результат: server/data/accounts.json (для сервера) и server/data/keys.csv (для печати).
 *
 *   npm run keys
 */

const STUDENT_KEY = /^stWeb-\d{3}$/;

// Без похожих символов: нет 0/O, 1/I/L — ключ легко продиктовать и переписать с листа.
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

const randomPart = (length) =>
  Array.from({ length }, () => ALPHABET[randomInt(ALPHABET.length)]).join('');

const rosterPath = join(DATA_DIR, 'roster.txt');
const accountsPath = join(DATA_DIR, 'accounts.json');

if (!existsSync(rosterPath)) {
  console.error(`Нет списка группы: ${rosterPath}\nСоздайте его — по одному ФИО в строке.`);
  process.exit(1);
}

const names = readFileSync(rosterPath, 'utf8')
  .split('\n')
  .map((line) => line.trim().replace(/\s+/g, ' '))
  .filter(Boolean);

const accounts = readJson(accountsPath, { admin: null, students: [] });
const outdated = accounts.students.filter((student) => !STUDENT_KEY.test(student.key));
const used = new Set(
  [accounts.admin?.key, ...accounts.students.filter((student) => !outdated.includes(student)).map((student) => student.key)]
    .map(normalizeKey),
);

function uniqueKey(make) {
  for (;;) {
    const key = make();
    if (!used.has(normalizeKey(key))) {
      used.add(normalizeKey(key));
      return key;
    }
  }
}

const studentKey = () => `stWeb-${String(randomInt(1000)).padStart(3, '0')}`;

accounts.admin ??= { key: uniqueKey(() => `ADM-${randomPart(4)}-${randomPart(4)}`) };
for (const student of outdated) student.key = uniqueKey(studentKey);

let added = 0;
for (const name of names) {
  if (accounts.students.some((student) => student.name === name)) continue;
  const number = accounts.students.length + 1;
  accounts.students.push({
    id: `s${String(number).padStart(2, '0')}`,
    name,
    key: uniqueKey(studentKey),
  });
  added += 1;
}

writeJson(accountsPath, accounts);

const csv = ['ФИО;ID для входа', ...accounts.students.map((student) => `${student.name};${student.key}`)];
writeFileSync(join(DATA_DIR, 'keys.csv'), `﻿${csv.join('\r\n')}\r\n`);

const markdown = [
  '# Ключи входа · Emmet · Тетрадь',
  '',
  `Обновлено: ${new Date().toLocaleString('ru-RU')}. Файл создаёт \`npm run keys\` — правки вручную перезапишутся.`,
  '',
  '## Преподаватель',
  '',
  `Панель преподавателя: \`/admin\` · ключ: **\`${accounts.admin.key}\`**`,
  '',
  '> Не показывайте этот ключ студентам: с ним видна статистика и ключи всей группы.',
  '',
  `## Студенты (${accounts.students.length})`,
  '',
  'Регистр букв и дефис при вводе не важны.',
  '',
  '| № | ФИО | ID для входа |',
  '| --- | --- | --- |',
  ...accounts.students.map((student, i) => `| ${i + 1} | ${student.name} | \`${student.key}\` |`),
  '',
];
writeFileSync(join(DATA_DIR, 'keys.md'), markdown.join('\n'));

console.log(`Студентов: ${accounts.students.length}, новых: ${added}, заменено ключей: ${outdated.length}\n`);
for (const student of accounts.students) console.log(`  ${student.key}  ${student.name}`);
console.log(`\nКлюч преподавателя: ${accounts.admin.key}`);
console.log(`Файлы: ${accountsPath}, ${join(DATA_DIR, 'keys.csv')}, ${join(DATA_DIR, 'keys.md')}`);
