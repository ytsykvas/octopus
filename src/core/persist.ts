/**
 * Атомарне читання та запис JSON-файлів із валідацією.
 *
 * Використовується і конфігом, і станом. Винесено окремо, щоб механіка
 * збереження була в одному місці, а не дублювалася (§11.3 docs/PROJECT.md).
 *
 * Головна гарантія: файл на диску або старий, або новий — ніколи обрізаний.
 * Досягається записом у тимчасовий файл і `rename`, який на POSIX атомарний.
 */

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

import type { z } from 'zod'

/** Файл не пройшов валідацію — дані на диску пошкоджені або з іншої версії. */
export class InvalidFileError extends Error {
  constructor(
    readonly filePath: string,
    readonly issues: string
  ) {
    super(`Файл ${filePath} має неочікувану структуру: ${issues}`)
    this.name = 'InvalidFileError'
  }
}

/**
 * Приводить довільне кинуте значення до читабельного рядка.
 *
 * У JS кинути можна будь-що, а `catch` дає `unknown`. Ця функція — єдине
 * місце, де ця незручність обробляється; далі по коду вже звичайний рядок.
 */
export function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function isNotFound(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT'
}

/**
 * Читає JSON і валідує схемою.
 *
 * Якщо файлу немає — повертає `fallback`: це нормальний перший запуск,
 * а не помилка. Якщо файл є, але зіпсований — кидає {@link InvalidFileError}
 * замість тихого скидання на типове значення, бо мовчазна втрата стану
 * гірша за явну помилку (§13).
 */
export async function readJsonFile<T>(
  filePath: string,
  schema: z.ZodType<T>,
  fallback: T
): Promise<T> {
  let raw: string

  try {
    raw = await readFile(filePath, 'utf8')
  } catch (error) {
    if (isNotFound(error)) return fallback
    throw error
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (error) {
    throw new InvalidFileError(filePath, describeError(error))
  }

  const result = schema.safeParse(parsed)
  if (!result.success) {
    throw new InvalidFileError(filePath, result.error.issues.map((i) => i.message).join('; '))
  }

  return result.data
}

/**
 * Атомарно записує JSON.
 *
 * Валідація перед записом навмисна: краще впасти тут, ніж покласти на диск
 * дані, які потім не прочитаються.
 */
export async function writeJsonFile<T>(
  filePath: string,
  schema: z.ZodType<T>,
  value: T,
  tempPath = `${filePath}.tmp`
): Promise<void> {
  const result = schema.safeParse(value)
  if (!result.success) {
    throw new InvalidFileError(filePath, result.error.issues.map((i) => i.message).join('; '))
  }

  await mkdir(dirname(filePath), { recursive: true })
  await writeFile(tempPath, `${JSON.stringify(result.data, null, 2)}\n`, 'utf8')
  await rename(tempPath, filePath)
}
