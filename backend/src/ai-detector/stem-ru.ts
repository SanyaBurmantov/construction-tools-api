/**
 * Porter's stemmer for Russian (the Snowball algorithm Postgres' `russian`
 * configuration uses too), so «высокую / высокая / высокой» are one word for
 * the uniqueness shingles. It folds case, number and gender endings, not
 * aspect pairs: «обеспечивает» and «обеспечит» stay apart, as in Snowball.
 * Words without Cyrillic (models, numbers, Latin) come back unchanged.
 */

const VOWELS = /^(.*?[аеиоуыэюя])(.*)$/;
const PERFECTIVE_GERUND =
  /(?:ив|ивши|ившись|ыв|ывши|ывшись|(?<=[ая])(?:в|вши|вшись))$/;
const REFLEXIVE = /(?:ся|сь)$/;
const ADJECTIVE =
  /(?:ее|ие|ые|ое|ими|ыми|ей|ий|ый|ой|ем|им|ым|ом|его|ого|ему|ому|их|ых|ую|юю|ая|яя|ою|ею)$/;
const PARTICIPLE = /(?:ивш|ывш|ующ|(?<=[ая])(?:ем|нн|вш|ющ|щ))$/;
const VERB =
  /(?:ила|ыла|ена|ейте|уйте|ите|или|ыли|ей|уй|ил|ыл|им|ым|ен|ило|ыло|ено|ят|ует|уют|ит|ыт|ены|ить|ыть|ишь|ую|ю|(?<=[ая])(?:ла|на|ете|йте|ли|й|л|ем|н|ло|но|ет|ют|ны|ть|ешь|нно))$/;
const NOUN =
  /(?:а|ев|ов|ие|ье|е|иями|ями|ами|еи|ии|и|ией|ей|ой|ий|й|иям|ям|ием|ем|ам|ом|о|у|ах|иях|ях|ы|ь|ию|ью|ю|ия|ья|я)$/;
const DERIVATIONAL = /[^аеиоуыэюя]+[аеиоуыэюя].*ость?$/;
const SUPERLATIVE = /(?:ейше|ейш)$/;

export function stemRu(input: string): string {
  const word = input.toLowerCase().replace(/ё/g, 'е');
  if (!/[а-я]/.test(word)) return word;
  const m = VOWELS.exec(word);
  if (!m || !m[2]) return word;
  const head = m[1];
  let rv = m[2];

  // Step 1: a perfective gerund, else reflexive + adjective/participle,
  // verb or noun ending.
  const gerund = rv.replace(PERFECTIVE_GERUND, '');
  if (gerund !== rv) {
    rv = gerund;
  } else {
    rv = rv.replace(REFLEXIVE, '');
    const adjective = rv.replace(ADJECTIVE, '');
    if (adjective !== rv) {
      rv = adjective.replace(PARTICIPLE, '');
    } else {
      const verb = rv.replace(VERB, '');
      rv = verb !== rv ? verb : rv.replace(NOUN, '');
    }
  }
  // Step 2: a final «и».
  rv = rv.replace(/и$/, '');
  // Step 3: derivational «ост(ь)» in R2.
  if (DERIVATIONAL.test(rv)) rv = rv.replace(/ость?$/, '');
  // Step 4: soft sign, superlative, double «н».
  const soft = rv.replace(/ь$/, '');
  if (soft !== rv) {
    rv = soft;
  } else {
    rv = rv.replace(SUPERLATIVE, '').replace(/нн$/, 'н');
  }
  return head + rv;
}
