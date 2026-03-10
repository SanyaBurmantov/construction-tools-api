export function generateSlug(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')  // заменяем всё кроме букв/цифр на дефис
    .replace(/^-|-$/g, '');        // убираем дефисы в начале и конце
}