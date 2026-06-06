const cyrillicMap: Record<string, string> = {
  а: 'a',
  б: 'b',
  в: 'v',
  г: 'g',
  д: 'd',
  е: 'e',
  ё: 'e',
  ж: 'zh',
  з: 'z',
  и: 'i',
  й: 'i',
  к: 'k',
  л: 'l',
  м: 'm',
  н: 'n',
  о: 'o',
  п: 'p',
  р: 'r',
  с: 's',
  т: 't',
  у: 'u',
  ф: 'f',
  х: 'h',
  ц: 'c',
  ч: 'ch',
  ш: 'sh',
  щ: 'shch',
  ы: 'y',
  э: 'e',
  ю: 'yu',
  я: 'ya',
  ь: '',
  ъ: '',
};

export function generateSlug(text: string) {
  return text
    .toLowerCase()
    .split('')
    .map((char) => cyrillicMap[char] ?? char) // транслитерируем кириллицу
    .join('')
    .replace(/[^a-z0-9]+/g, '-') // заменяем всё кроме латиницы/цифр на дефис
    .replace(/^-|-$/g, ''); // убираем дефисы в начале и конце
}
